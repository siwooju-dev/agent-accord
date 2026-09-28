import json
from pathlib import Path
import pytest
from web3 import Web3, EthereumTesterProvider
from eth_tester import EthereumTester, PyEVMBackend
from eth_tester.exceptions import TransactionFailed
from app.config import Settings
from app.chain import EvmChain
from app.main import create_app
from app.policy import digest
from app import db as m
from app.worker import process_record
from conftest import start, post, approval


@pytest.fixture
def evm():
    path = Path(__file__).resolve().parents[3] / "chain/artifacts/AuditRegistry.json"
    assert path.exists(), "Run npm --prefix chain ci && npm --prefix chain run compile before pytest"
    artifact = json.loads(path.read_text())
    backend = PyEVMBackend()
    w3 = Web3(EthereumTesterProvider(EthereumTester(backend=backend)))
    owner = w3.eth.accounts[0]
    factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    receipt = w3.eth.wait_for_transaction_receipt(factory.constructor(owner).transact({"from": owner}))
    cfg = Settings(chain_mode="evm", chain_network="devnet", chain_id=w3.eth.chain_id,
                   chain_allowed_ids=str(w3.eth.chain_id), chain_evidence="in-process EVM unit test only; not organizer approval",
                   chain_rpc="in-process", chain_contract=receipt.contractAddress,
                   relayer_key=backend.account_keys[0].to_hex())
    cfg.validate()
    return w3, EvmChain(cfg, web3=w3), cfg


def test_contract_relayer_duplicate_and_zero_hash_guards(evm):
    w3, chain, _ = evm
    rid, hashed = bytes.fromhex("1" * 64), bytes.fromhex("2" * 64)
    with pytest.raises(TransactionFailed): chain.contract.functions.record(rid, hashed).transact({"from": w3.eth.accounts[1]})
    with pytest.raises(TransactionFailed): chain.contract.functions.record(rid, bytes(32)).transact({"from": w3.eth.accounts[0]})
    chain.contract.functions.record(rid, hashed).transact({"from": w3.eth.accounts[0]})
    with pytest.raises(TransactionFailed): chain.contract.functions.record(rid, hashed).transact({"from": w3.eth.accounts[0]})


def test_signed_tx_receipt_event_query_hash_match_and_mismatch(evm):
    w3, chain, cfg = evm
    record_id, audit_hash = "3" * 64, "4" * 64
    data = chain.prepare(record_id, audit_hash, chain.pending_nonce())
    chain.broadcast(data)
    result = chain.reconcile(record_id, audit_hash, {k:v for k,v in data.items() if k!='raw_tx'})
    assert result["status"] == "CONFIRMED" and result["receipt"]["status"] == 1
    assert result["event"]["audit_hash"] == audit_hash
    assert chain.reconcile(record_id, "5" * 64, data)["status"] == "FAILED"
    assert chain.reconcile(record_id, audit_hash, data | {"tx_hash": "0x" + "6"*64})["status"] == "UNKNOWN"
    cfg.chain_id += 1
    with pytest.raises(ValueError,match="CHAIN_ID_MISMATCH"): chain.pending_nonce()


def test_minimum_confirmations_are_enforced(evm):
    w3, chain, cfg = evm
    cfg.confirmations = 2
    data = chain.prepare("7"*64, "8"*64, chain.pending_nonce())
    chain.broadcast(data)
    assert chain.reconcile("7"*64, "8"*64, data)["status"] == "PENDING"
    w3.provider.ethereum_tester.mine_blocks(1)
    assert chain.reconcile("7"*64, "8"*64, data)["status"] == "CONFIRMED"


def test_api_approval_to_local_evm_outbox_record(rig, evm):
    app, client = rig
    w3, chain, cfg = evm
    app.state.chain = chain
    # Runtime app settings are shared by the API, evidence views and nonce worker.
    app.state.settings.chain_id = cfg.chain_id
    app.state.settings.chain_mode = "evm"
    app.state.settings.chain_contract = cfg.chain_contract
    base, deal = start(client)
    assert post(client, base + "/agreement/approve", approval(deal)).status_code == 202
    result = client.get(base).json()
    assert result["status"] == "RECORDED"
    assert result["chain"]["adapter_mode"] == "evm"
    assert result["chain"]["receipt"]["status"] == 1
    assert result["chain"]["event"]["audit_hash"] == digest(deal["agreement"]["snapshot"])
    nonce = w3.eth.get_transaction_count(w3.eth.accounts[0])
    process_record(app, result["chain"]["record_id"])
    assert w3.eth.get_transaction_count(w3.eth.accounts[0]) == nonce


def test_broadcast_unknown_recovers_saved_tx_without_another_send(rig, evm):
    app, client = rig
    w3, chain, cfg = evm
    original = chain.broadcast
    sends = 0
    def send_and_lose_response(data):
        nonlocal sends
        sends += 1
        original(data)
        raise TimeoutError()
    chain.broadcast = send_and_lose_response
    app.state.chain = chain
    app.state.settings.chain_id, app.state.settings.chain_contract = cfg.chain_id, cfg.chain_contract
    app.state.settings.chain_mode = "evm"
    base, deal = start(client)
    post(client, base + "/agreement/approve", approval(deal))
    before = client.get(base).json()["chain"]
    assert before["status"] == "UNKNOWN" and before["tx_hash"] and before["nonce"] is not None
    post(client, base + "/chain/reconcile", {"expected_policy_version": 1})
    after = client.get(base).json()["chain"]
    assert after["status"] == "CONFIRMED" and before["tx_hash"] == after["tx_hash"] and sends == 1
