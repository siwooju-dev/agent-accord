"""Exact v1 JCS/SHA-256 and EIP-712 encoding shared with the API layer."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Mapping

import rfc8785
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3


SNAPSHOT_FIELDS = frozenset({
    "snapshot_version", "agreement_id", "offer_id", "listing_id", "seller_id",
    "gpu_model", "item_price_krw", "shipping_fee_krw", "total_krw",
    "delivery_by", "warranty_terms", "evidence_hashes", "buyer_wallet",
    "seller_wallet", "expires_at", "nonce",
})
DOMAIN = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]
APPROVAL = [
    {"name": "agreementHash", "type": "bytes32"},
    {"name": "buyer", "type": "address"},
    {"name": "seller", "type": "address"},
    {"name": "totalKrw", "type": "uint256"},
    {"name": "nonce", "type": "uint256"},
    {"name": "deadline", "type": "uint256"},
]
_LOWER_ADDRESS = re.compile(r"0x[0-9a-f]{40}\Z")
_LOWER_HASH = re.compile(r"0x[0-9a-f]{64}\Z")
_UTC_SECOND = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z")
_SAFE_MAX = 2**53 - 1


class ApprovalError(ValueError):
    """Invalid snapshot, typed data, or signature."""


def _datetime_seconds(value: Any) -> int:
    if not isinstance(value, str) or not _UTC_SECOND.fullmatch(value):
        raise ApprovalError("time must be UTC YYYY-MM-DDTHH:MM:SSZ")
    try:
        return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())
    except ValueError as exc:
        raise ApprovalError("invalid UTC time") from exc


def _safe_int(value: Any, *, positive: bool) -> int:
    if type(value) is not int or value < (1 if positive else 0) or value > _SAFE_MAX:
        raise ApprovalError("amount and nonce must be JSON-safe integers")
    return value


def validate_snapshot(snapshot: Mapping[str, Any]) -> None:
    if not isinstance(snapshot, Mapping) or set(snapshot) != SNAPSHOT_FIELDS:
        raise ApprovalError("snapshot fields differ from v1")
    if type(snapshot["snapshot_version"]) is not int or snapshot["snapshot_version"] != 1:
        raise ApprovalError("unsupported snapshot version")
    for field in ("agreement_id", "offer_id", "listing_id", "seller_id", "gpu_model", "warranty_terms"):
        if not isinstance(snapshot[field], str) or not snapshot[field]:
            raise ApprovalError(f"invalid {field}")
    for field in ("buyer_wallet", "seller_wallet"):
        if not isinstance(snapshot[field], str) or not _LOWER_ADDRESS.fullmatch(snapshot[field]):
            raise ApprovalError(f"invalid {field}")
    if snapshot["buyer_wallet"] == snapshot["seller_wallet"]:
        raise ApprovalError("buyer and seller must differ")
    price = _safe_int(snapshot["item_price_krw"], positive=True)
    fee = _safe_int(snapshot["shipping_fee_krw"], positive=False)
    total = _safe_int(snapshot["total_krw"], positive=True)
    _safe_int(snapshot["nonce"], positive=True)
    if price + fee != total:
        raise ApprovalError("total does not equal item price plus shipping")
    _datetime_seconds(snapshot["delivery_by"])
    _datetime_seconds(snapshot["expires_at"])
    hashes = snapshot["evidence_hashes"]
    if not isinstance(hashes, list) or any(not isinstance(h, str) or not _LOWER_HASH.fullmatch(h) for h in hashes):
        raise ApprovalError("invalid evidence hashes")
    if hashes != sorted(set(hashes)):
        raise ApprovalError("evidence hashes must be sorted and unique")


def snapshot_hash(snapshot: Mapping[str, Any]) -> str:
    validate_snapshot(snapshot)
    try:
        canonical = rfc8785.dumps(dict(snapshot))
    except (TypeError, ValueError) as exc:
        raise ApprovalError("cannot canonicalize snapshot") from exc
    return "0x" + hashlib.sha256(canonical).hexdigest()


def approval_payload(
    snapshot: Mapping[str, Any], *, chain_id: int, contract_address: str,
    expected_hash: str | None = None,
) -> dict[str, Any]:
    agreement_hash = snapshot_hash(snapshot)
    if expected_hash is not None and agreement_hash != expected_hash:
        raise ApprovalError("snapshot hash mismatch")
    if type(chain_id) is not int or chain_id <= 0 or not Web3.is_address(contract_address):
        raise ApprovalError("CHAIN_CONFIG_UNAVAILABLE")
    typed_data = {
        "domain": {
            "name": "AgentAccord", "version": "1", "chainId": chain_id,
            "verifyingContract": Web3.to_checksum_address(contract_address),
        },
        "types": {"EIP712Domain": DOMAIN, "AgreementApproval": APPROVAL},
        "primaryType": "AgreementApproval",
        "message": {
            "agreementHash": agreement_hash,
            "buyer": Web3.to_checksum_address(snapshot["buyer_wallet"]),
            "seller": Web3.to_checksum_address(snapshot["seller_wallet"]),
            "totalKrw": snapshot["total_krw"],
            "nonce": snapshot["nonce"],
            "deadline": _datetime_seconds(snapshot["expires_at"]),
        },
    }
    return {"snapshot": dict(snapshot), "snapshot_hash": agreement_hash, "typed_data": typed_data}


def verify_approval_signature(
    payload: Mapping[str, Any], signature: str, expected_wallet: str, *,
    chain_id: int, contract_address: str, now: int | None = None,
) -> str:
    """Rebuild typed data from the immutable snapshot; never trust client supplied fields."""
    if not isinstance(payload, Mapping) or "snapshot" not in payload or "typed_data" not in payload:
        raise ApprovalError("complete approval payload required")
    trusted = approval_payload(
        payload["snapshot"], chain_id=chain_id, contract_address=contract_address,
        expected_hash=payload.get("snapshot_hash"),
    )
    if payload["typed_data"] != trusted["typed_data"]:
        raise ApprovalError("typed data differs from snapshot or chain")
    if not isinstance(expected_wallet, str) or not Web3.is_address(expected_wallet):
        raise ApprovalError("invalid expected wallet")
    if expected_wallet.lower() not in (
        trusted["snapshot"]["buyer_wallet"], trusted["snapshot"]["seller_wallet"]
    ):
        raise ApprovalError("SIGNATURE_INVALID")
    if (int(datetime.now(timezone.utc).timestamp()) if now is None else now) > trusted["typed_data"]["message"]["deadline"]:
        raise ApprovalError("approval expired")
    if not isinstance(signature, str) or not re.fullmatch(r"0x[0-9a-fA-F]{130}", signature):
        raise ApprovalError("SIGNATURE_INVALID")
    try:
        recovered = Account.recover_message(
            encode_typed_data(full_message=trusted["typed_data"]), signature=signature
        )
    except (TypeError, ValueError) as exc:
        raise ApprovalError("SIGNATURE_INVALID") from exc
    if recovered.lower() != expected_wallet.lower():
        raise ApprovalError("SIGNATURE_INVALID")
    return recovered
