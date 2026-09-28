"""Explicit opt-in deployment to an organizer-approved devnet/testnet. No token transfers."""
import argparse
import json
import sys
from pathlib import Path
from eth_account import Account
from web3 import Web3
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import Settings

parser = argparse.ArgumentParser()
parser.add_argument("--deploy-approved-network", action="store_true", required=True)
args = parser.parse_args()
cfg = Settings.env()
# Deployment cannot require a not-yet-created contract. The dummy value is never sent.
cfg.chain_contract = cfg.chain_contract or "deployment-pending"
cfg.chain_mode = "evm"
cfg.validate()
w3 = Web3(Web3.HTTPProvider(cfg.chain_rpc, request_kwargs={"timeout": 15}))
if w3.eth.chain_id != cfg.chain_id: raise SystemExit("CHAIN_ID_MISMATCH")
account = Account.from_key(cfg.relayer_key)
artifact = json.loads((Path(__file__).resolve().parents[1] / "chain/artifacts/AuditRegistry.json").read_text())
factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
tx = factory.constructor(account.address).build_transaction({"from": account.address, "chainId": cfg.chain_id, "nonce": w3.eth.get_transaction_count(account.address,"pending"), "value": 0})
signed = account.sign_transaction(tx)
# Hash known before sending; a timeout MUST be reconciled with this hash, not redeployed.
print(json.dumps({"status":"PREPARED", "tx_hash":Web3.to_hex(signed.hash), "chain_id":cfg.chain_id}),flush=True)
try:
    w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(signed.hash, timeout=60)
    if receipt.status != 1 or not receipt.contractAddress or not w3.eth.get_code(receipt.contractAddress): raise ValueError("Deployment failed")
    contract = w3.eth.contract(address=receipt.contractAddress,abi=artifact["abi"])
    if contract.functions.relayer().call() != account.address: raise ValueError("Wrong relayer")
    print(json.dumps({"status":"DEPLOYED", "chain_id":cfg.chain_id, "contract":receipt.contractAddress, "tx_hash":Web3.to_hex(signed.hash), "receipt":json.loads(w3.to_json(receipt))}))
except Exception:
    print(json.dumps({"status":"UNKNOWN_OR_FAILED", "tx_hash":Web3.to_hex(signed.hash), "next":"Query this tx hash; do not blindly redeploy"}))
    raise SystemExit(1)
