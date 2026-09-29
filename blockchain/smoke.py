"""Submit one synthetic, dual-signed agreement to a configured devnet/testnet.

The buyer and seller wallets are ephemeral test accounts. This proves the chain
path, not that two real users approved a marketplace transaction.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from .adapter import AgreementChain, ChainConfig, ChainError, SubmissionUnknown
from .signing import snapshot_hash


def _utc_second(seconds: int) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _persist_tx_hash(path: Path, agreement_id: str, agreement_hash: str, tx_hash: str) -> None:
    """Create an exclusive, fsynced recovery file before any broadcast."""
    data = {"agreement_id": agreement_id, "agreement_hash": agreement_hash, "tx_hash": tx_hash}
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(data, handle, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def run_smoke(chain: AgreementChain, tx_file: Path, *, receipt_timeout: int = 120) -> dict:
    if tx_file.exists():
        raise ChainError(f"tx recovery file already exists: {tx_file}")
    buyer = Account.create()
    seller = Account.create()
    chain_time = int(chain.web3.eth.get_block("latest")["timestamp"])
    agreement_id = "smoke-" + uuid4().hex
    snapshot = {
        "snapshot_version": 1,
        "agreement_id": agreement_id,
        "offer_id": "offer-" + agreement_id,
        "listing_id": "listing-" + agreement_id,
        "seller_id": "seller-smoke",
        "gpu_model": "RTX 3070",
        "item_price_krw": 450000,
        "shipping_fee_krw": 10000,
        "total_krw": 460000,
        "delivery_by": _utc_second(chain_time + 7 * 24 * 3600),
        "warranty_terms": "synthetic smoke test; no product or warranty",
        "evidence_hashes": [],
        "buyer_wallet": buyer.address.lower(),
        "seller_wallet": seller.address.lower(),
        "expires_at": _utc_second(chain_time + 3600),
        "nonce": 1,
    }
    agreement_hash = snapshot_hash(snapshot)
    agreement = {"id": agreement_id, "snapshot": snapshot, "snapshot_hash": agreement_hash}
    payload = chain.prepare_approval(agreement)
    signable = encode_typed_data(full_message=payload["typed_data"])
    buyer_signature = Web3.to_hex(Account.sign_message(signable, buyer.key).signature)
    seller_signature = Web3.to_hex(Account.sign_message(signable, seller.key).signature)
    try:
        submission = chain.record_agreement(
            agreement, buyer_signature, seller_signature,
            persist_tx_hash=lambda tx_hash: _persist_tx_hash(tx_file, agreement_id, agreement_hash, tx_hash),
        )
    except SubmissionUnknown:
        # The recovery file is already durable; the caller can reconcile this hash.
        raise
    if submission["status"] != "submitted":
        raise ChainError("fresh synthetic agreement was not submitted")
    tx_hash = submission["tx_hash"]
    stop_at = time.monotonic() + receipt_timeout
    while True:
        record = chain.get_record(tx_hash, agreement_hash)
        if record["status"] == "success":
            if (
                record["buyer"].lower() != snapshot["buyer_wallet"]
                or record["seller"].lower() != snapshot["seller_wallet"]
                or record["total_krw"] != snapshot["total_krw"]
                or record["nonce"] != snapshot["nonce"]
            ):
                raise ChainError("confirmed record differs from synthetic agreement")
            return {"mode": "synthetic_wallet_smoke", "agreement_id": agreement_id,
                    "tx_file": str(tx_file), **record}
        if record["status"] == "failed":
            raise ChainError(f"recording transaction failed: {tx_hash}")
        if time.monotonic() >= stop_at:
            raise ChainError(f"receipt not confirmed; reconcile saved tx hash: {tx_hash}")
        time.sleep(2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tx-file", type=Path, help="new file for the tx hash, created before broadcast")
    parser.add_argument("--timeout", type=int, default=120, help="receipt wait in seconds")
    args = parser.parse_args()
    if args.timeout < 0:
        parser.error("--timeout must be nonnegative")
    if args.tx_file is None:
        records_dir = Path(__file__).resolve().parent.parent / ".local"
        records_dir.mkdir(mode=0o700, exist_ok=True)
        tx_file = records_dir / f"smoke-{uuid4().hex}.json"
    else:
        tx_file = args.tx_file
    chain = AgreementChain(ChainConfig.from_env())
    print("mode=synthetic_wallet_smoke", flush=True)
    print(f"tx_recovery_file={tx_file}", flush=True)
    result = run_smoke(chain, tx_file, receipt_timeout=args.timeout)
    for key in ("chain_id", "agreement_id", "agreement_hash", "tx_hash", "block_number", "buyer", "seller", "total_krw", "status"):
        print(f"{key}={result[key]}")
    explorer = os.environ.get("CHAIN_EXPLORER_URL", "").rstrip("/")
    if explorer:
        print(f"explorer_tx={explorer}/tx/{result['tx_hash']}")


if __name__ == "__main__":
    main()
