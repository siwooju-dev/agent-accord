"""Deploy AgreementRegistry to Base Sepolia with the relayer in `.env.local`, then record it.

    .venv/bin/python scripts/deploy_registry.py            # checks balance, deploys, updates the deployments file
    .venv/bin/python scripts/deploy_registry.py --check    # only prints relayer address, balance and current file

Needs `contracts/build/AgreementRegistry.bytecode.json` (cd contracts && npm ci && npm run compile).
Prints the deployment tx hash before broadcasting so a timeout can be reconciled instead of redeployed.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import load_local_env  # noqa: E402

DEPLOYMENTS = ROOT / "blockchain" / "deployments" / "base-sepolia.json"
BYTECODE = ROOT / "contracts" / "build" / "AgreementRegistry.bytecode.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    load_local_env()
    import os

    from eth_account import Account
    from web3 import Web3

    from blockchain.deploy import deploy_contract

    rpc = os.getenv("CHAIN_RPC_URL", "https://sepolia.base.org")
    chain_id = int(os.getenv("CHAIN_ID", "84532"))
    explorer = os.getenv("CHAIN_EXPLORER_URL", "https://sepolia.basescan.org").rstrip("/")
    if chain_id != 84532:
        print("CHAIN_ID는 Base Sepolia 84532여야 합니다.", file=sys.stderr)
        return 2
    key = os.getenv("RELAYER_PRIVATE_KEY", "").strip()
    if not key:
        print("RELAYER_PRIVATE_KEY가 없습니다. 먼저 scripts/setup_secrets.py --relayer 를 실행하세요.", file=sys.stderr)
        return 1
    relayer = Account.from_key(key).address
    web3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 20}))
    if not web3.is_connected() or web3.eth.chain_id != chain_id:
        print(f"RPC 연결 실패 또는 chain ID 불일치: {rpc}", file=sys.stderr)
        return 1
    balance = web3.eth.get_balance(relayer)
    current = json.loads(DEPLOYMENTS.read_text(encoding="utf-8")) if DEPLOYMENTS.exists() else {}
    print(f"relayer: {relayer}")
    print(f"balance: {Web3.from_wei(balance, 'ether')} ETH (chain {chain_id})")
    print(f"current contract: {current.get('contract_address')} (relayer {current.get('relayer_address')})")
    if args.check:
        return 0
    if (current.get("relayer_address") or "").lower() == relayer.lower():
        print("이 relayer로 이미 배포되어 있습니다. 다시 배포하지 않습니다.")
        return 0
    if balance == 0:
        print("잔액이 0입니다. Base Sepolia faucet에서 테스트 ETH를 받은 뒤 다시 실행하세요.", file=sys.stderr)
        return 1
    if not BYTECODE.exists():
        print("컴파일 결과가 없습니다: cd contracts && npm ci && npm run compile", file=sys.stderr)
        return 1

    result = deploy_contract(web3, chain_id, key)
    previous = [item for item in current.get("previous_deployments", [])]
    if current.get("contract_address"):
        previous.insert(0, {key_: current[key_] for key_ in (
            "contract_address", "relayer_address", "deployment", "smoke_record", "verification", "limitation",
        ) if key_ in current})
    record = {
        "network": "Base Sepolia",
        "chain_id": chain_id,
        "contract_address": result["contract_address"],
        "relayer_address": relayer,
        "deployment": {
            "tx_hash": result["deployment_tx_hash"],
            "block_number": result["block_number"],
            "receipt_status": 1,
            "deployed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        },
        "verification": "receipt status 1 and relayer() matched the configured relayer",
        "previous_deployments": previous,
    }
    DEPLOYMENTS.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"contract: {result['contract_address']}")
    print(f"tx: {explorer}/tx/{result['deployment_tx_hash']}")
    print(f"저장: {DEPLOYMENTS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
