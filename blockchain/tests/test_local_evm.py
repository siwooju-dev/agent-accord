"""Deploy the real Solidity bytecode and exercise web3 relayer on PyEVM."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_tester.exceptions import TransactionFailed
from web3 import Web3
from web3.providers.eth_tester import EthereumTesterProvider

from blockchain import AgreementChain, ChainConfig, ChainError, SubmissionUnknown, approval_payload
from blockchain.deploy import deploy_contract
from blockchain.smoke import run_smoke
from blockchain.tests.test_signing import VECTOR


ROOT = Path(__file__).resolve().parents[2]
ABI_PATH = ROOT / "blockchain/abi/AgreementRegistry.json"
BYTECODE_PATH = ROOT / "contracts/build/AgreementRegistry.bytecode.json"


@pytest.fixture
def local_chain():
    if not BYTECODE_PATH.exists():
        pytest.fail("run `npm run compile` in contracts/ to create bytecode")
    web3 = Web3(EthereumTesterProvider())
    tester = web3.provider.ethereum_tester
    relayer = Account.from_key(tester.backend.account_keys[0].to_bytes())
    buyer = Account.from_key(tester.backend.account_keys[1].to_bytes())
    seller = Account.from_key(tester.backend.account_keys[2].to_bytes())
    abi = json.loads(ABI_PATH.read_text(encoding="utf-8"))
    bytecode = json.loads(BYTECODE_PATH.read_text(encoding="utf-8"))["bytecode"]
    factory = web3.eth.contract(abi=abi, bytecode=bytecode)
    tx_hash = factory.constructor(relayer.address).transact({"from": relayer.address})
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1
    config = ChainConfig("memory://", web3.eth.chain_id, receipt["contractAddress"], Web3.to_hex(relayer.key))
    chain = AgreementChain(config, web3)
    snapshot = deepcopy(VECTOR)
    snapshot["buyer_wallet"] = buyer.address.lower()
    snapshot["seller_wallet"] = seller.address.lower()
    payload = approval_payload(snapshot, chain_id=config.chain_id, contract_address=config.contract_address)
    signable = encode_typed_data(full_message=payload["typed_data"])
    buyer_sig = Web3.to_hex(Account.sign_message(signable, buyer.key).signature)
    seller_sig = Web3.to_hex(Account.sign_message(signable, seller.key).signature)
    agreement = {"id": snapshot["agreement_id"], "snapshot": snapshot, "snapshot_hash": payload["snapshot_hash"]}
    return chain, agreement, buyer_sig, seller_sig


def test_real_record_receipt_event_storage_and_retry(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain
    persisted = []
    result = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append
    )
    assert result["status"] == "submitted"
    assert persisted == [result["tx_hash"]]
    record = chain.get_record(result["tx_hash"], agreement["snapshot_hash"])
    assert record["status"] == "success"
    assert record["buyer"].lower() == agreement["snapshot"]["buyer_wallet"]
    assert record["seller"].lower() == agreement["snapshot"]["seller_wallet"]
    assert record["total_krw"] == agreement["snapshot"]["total_krw"]
    assert record["nonce"] == agreement["snapshot"]["nonce"]
    assert record["block_number"] > 0
    prior = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append,
        previous_tx_hash=result["tx_hash"],
    )
    assert prior["status"] == "previous_submission"
    assert prior["record"]["status"] == "success"
    assert persisted == [result["tx_hash"]]
    duplicate = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append
    )
    assert duplicate["status"] == "already_recorded"
    assert persisted == [result["tx_hash"]]


def test_wrong_signature_never_broadcasts(local_chain):
    chain, agreement, buyer_sig, _ = local_chain
    persisted = []
    with pytest.raises(ChainError, match="invalid agreement or signatures"):
        chain.record_agreement(
            agreement, buyer_sig, buyer_sig, persist_tx_hash=persisted.append
        )
    assert persisted == []
    assert not chain._stored(agreement["snapshot_hash"])[0]


def test_wrong_chain_and_contract_address_rejected(local_chain):
    chain, _, _, _ = local_chain
    config = chain.config
    with pytest.raises(ChainError, match="chain ID mismatch"):
        AgreementChain(ChainConfig(config.rpc_url, config.chain_id + 1, config.contract_address, config.relayer_private_key), chain.web3)
    with pytest.raises(ChainError, match="contract not deployed"):
        AgreementChain(ChainConfig(config.rpc_url, config.chain_id, "0x" + "44" * 20, config.relayer_private_key), chain.web3)


def test_failed_hash_persistence_prevents_broadcast(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain

    def failed_commit(_tx_hash):
        raise RuntimeError("DB commit failed")

    with pytest.raises(RuntimeError, match="DB commit failed"):
        chain.record_agreement(
            agreement, buyer_sig, seller_sig, persist_tx_hash=failed_commit
        )
    assert not chain._stored(agreement["snapshot_hash"])[0]


def test_rpc_response_loss_recovers_original_transaction(local_chain, monkeypatch):
    chain, agreement, buyer_sig, seller_sig = local_chain
    persisted = []
    original_send = chain.web3.eth.send_raw_transaction

    def send_then_lose_response(raw_transaction):
        original_send(raw_transaction)
        raise TimeoutError("response lost after broadcast")

    monkeypatch.setattr(chain.web3.eth, "send_raw_transaction", send_then_lose_response)
    with pytest.raises(SubmissionUnknown) as error:
        chain.record_agreement(
            agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append
        )
    assert persisted == [error.value.tx_hash]
    recovered = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append,
        previous_tx_hash=persisted[0],
    )
    assert recovered["record"]["status"] == "success"
    assert persisted == [error.value.tx_hash]


def test_contract_itself_rejects_wrong_signature_and_replay(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain
    payload = chain.prepare_approval(agreement)
    message = payload["typed_data"]["message"]
    function = chain.contract.functions.recordAgreement
    args = (
        agreement["snapshot_hash"], message["buyer"], message["seller"],
        message["totalKrw"], message["nonce"], message["deadline"],
    )
    with pytest.raises(TransactionFailed):
        function(*args, seller_sig, seller_sig).transact({"from": chain.relayer.address})
    assert not chain._stored(agreement["snapshot_hash"])[0]
    function(*args, buyer_sig, seller_sig).transact({"from": chain.relayer.address})
    with pytest.raises(TransactionFailed):
        function(*args, buyer_sig, seller_sig).transact({"from": chain.relayer.address})


def test_contract_itself_rejects_expired_approval(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain
    payload = chain.prepare_approval(agreement)
    message = payload["typed_data"]["message"]
    tester = chain.web3.provider.ethereum_tester
    tester.time_travel(message["deadline"] + 1)
    tester.mine_block()
    with pytest.raises(TransactionFailed):
        chain.contract.functions.recordAgreement(
            agreement["snapshot_hash"], message["buyer"], message["seller"],
            message["totalKrw"], message["nonce"], message["deadline"],
            buyer_sig, seller_sig,
        ).transact({"from": chain.relayer.address})
    assert not chain._stored(agreement["snapshot_hash"])[0]


def test_deployment_command_signs_and_checks_contract(capsys):
    web3 = Web3(EthereumTesterProvider())
    key = Web3.to_hex(web3.provider.ethereum_tester.backend.account_keys[0].to_bytes())
    result = deploy_contract(web3, web3.eth.chain_id, key)
    output = capsys.readouterr().out
    assert f"deployment_tx_hash={result['deployment_tx_hash']}" in output
    assert result["block_number"] > 0
    assert web3.eth.get_code(result["contract_address"])


def test_pending_then_confirmed_receipt(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain
    tester = chain.web3.provider.ethereum_tester
    tester.disable_auto_mine_transactions()
    persisted = []
    result = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=persisted.append
    )
    assert chain.get_record(result["tx_hash"], agreement["snapshot_hash"])["status"] == "pending"
    tester.mine_block()
    assert chain.get_record(result["tx_hash"], agreement["snapshot_hash"])["status"] == "success"


def test_unknown_transaction_is_not_found(local_chain):
    chain, agreement, _, _ = local_chain
    result = chain.get_record("0x" + "ff" * 32, agreement["snapshot_hash"])
    assert result["status"] == "not_found"


def test_reverted_transaction_is_failed(local_chain):
    chain, agreement, buyer_sig, seller_sig = local_chain
    result = chain.record_agreement(
        agreement, buyer_sig, seller_sig, persist_tx_hash=lambda _: None
    )
    assert chain.get_record(result["tx_hash"], agreement["snapshot_hash"])["status"] == "success"
    message = chain.prepare_approval(agreement)["typed_data"]["message"]
    duplicate_hash = chain.contract.functions.recordAgreement(
        agreement["snapshot_hash"], message["buyer"], message["seller"],
        message["totalKrw"], message["nonce"], message["deadline"],
        buyer_sig, seller_sig,
    ).transact({"from": chain.relayer.address, "gas": 400000})
    assert chain.get_record(Web3.to_hex(duplicate_hash), agreement["snapshot_hash"])["status"] == "failed"


def test_synthetic_smoke_records_and_persists_hash(local_chain, tmp_path):
    chain, _, _, _ = local_chain
    tx_file = tmp_path / "smoke-tx.json"
    result = run_smoke(chain, tx_file, receipt_timeout=0)
    persisted = json.loads(tx_file.read_text(encoding="utf-8"))
    assert result["mode"] == "synthetic_wallet_smoke"
    assert result["status"] == "success"
    assert persisted["agreement_hash"] == result["agreement_hash"]
    assert persisted["tx_hash"] == result["tx_hash"]
    with pytest.raises(ChainError, match="already exists"):
        run_smoke(chain, tx_file)
