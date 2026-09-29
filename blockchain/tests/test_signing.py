from copy import deepcopy

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak
from web3 import Web3

from blockchain.signing import ApprovalError, approval_payload, snapshot_hash, verify_approval_signature


VECTOR = {
    "snapshot_version": 1,
    "agreement_id": "agreement-vector-1",
    "offer_id": "offer-vector-1",
    "listing_id": "listing-vector-1",
    "seller_id": "seller-vector-1",
    "gpu_model": "RTX 3070",
    "item_price_krw": 450000,
    "shipping_fee_krw": 10000,
    "total_krw": 460000,
    "delivery_by": "2030-01-03T12:00:00Z",
    "warranty_terms": "seller warranty until 2031-01-31",
    "evidence_hashes": ["0x" + "11" * 32],
    "buyer_wallet": "0x" + "11" * 20,
    "seller_wallet": "0x" + "22" * 20,
    "expires_at": "2030-01-01T12:00:00Z",
    "nonce": 1,
}
CONTRACT = "0x" + "33" * 20


def test_documented_snapshot_hash_and_deadline():
    assert snapshot_hash(VECTOR) == "0x10c8bc9492fea93859ecb238acd53f1b86c4c34895187be9116f35811e5556cc"
    payload = approval_payload(VECTOR, chain_id=84532, contract_address=CONTRACT)
    assert payload["typed_data"]["message"]["deadline"] == 1893499200
    assert payload["typed_data"]["primaryType"] == "AgreementApproval"
    signable = encode_typed_data(full_message=payload["typed_data"])
    digest = "0x" + keccak(b"\x19" + signable.version + signable.header + signable.body).hex()
    assert digest == "0x20517f730396299e6b81037818241ee1c2c442406b3d77c047821c8d3aa3554b"


def test_two_wallets_sign_the_same_payload():
    buyer = Account.create()
    seller = Account.create()
    snapshot = deepcopy(VECTOR)
    snapshot["buyer_wallet"] = buyer.address.lower()
    snapshot["seller_wallet"] = seller.address.lower()
    payload = approval_payload(snapshot, chain_id=84532, contract_address=CONTRACT)
    signable = encode_typed_data(full_message=payload["typed_data"])
    buyer_sig = Web3.to_hex(Account.sign_message(signable, buyer.key).signature)
    seller_sig = Web3.to_hex(Account.sign_message(signable, seller.key).signature)
    assert verify_approval_signature(payload, buyer_sig, buyer.address, chain_id=84532, contract_address=CONTRACT, now=1893499100) == buyer.address
    assert verify_approval_signature(payload, seller_sig, seller.address, chain_id=84532, contract_address=CONTRACT, now=1893499100) == seller.address
    with pytest.raises(ApprovalError, match="SIGNATURE_INVALID"):
        verify_approval_signature(payload, buyer_sig, seller.address, chain_id=84532, contract_address=CONTRACT, now=1893499100)
    with pytest.raises(ApprovalError, match="SIGNATURE_INVALID"):
        verify_approval_signature(payload, buyer_sig, Account.create().address, chain_id=84532, contract_address=CONTRACT, now=1893499100)
    with pytest.raises(ApprovalError, match="expired"):
        verify_approval_signature(payload, buyer_sig, buyer.address, chain_id=84532, contract_address=CONTRACT, now=1893499201)
    with pytest.raises(ApprovalError, match="typed data differs"):
        verify_approval_signature(payload, buyer_sig, buyer.address, chain_id=1, contract_address=CONTRACT, now=1893499100)


def test_changes_require_new_hash_and_both_signatures():
    original = approval_payload(VECTOR, chain_id=84532, contract_address=CONTRACT)
    changed = deepcopy(VECTOR)
    changed["shipping_fee_krw"] += 1
    changed["total_krw"] += 1
    assert snapshot_hash(changed) != original["snapshot_hash"]
    with pytest.raises(ApprovalError, match="snapshot hash mismatch"):
        approval_payload(changed, chain_id=84532, contract_address=CONTRACT, expected_hash=original["snapshot_hash"])


@pytest.mark.parametrize("field,value", [
    ("total_krw", True), ("total_krw", 460000.0), ("nonce", 0),
    ("expires_at", "2030-01-01T12:00:00+00:00"),
    ("buyer_wallet", "0x" + "AA" * 20),
    ("evidence_hashes", ["0x" + "11" * 32] * 2),
])
def test_invalid_snapshot_rejected(field, value):
    changed = deepcopy(VECTOR)
    changed[field] = value
    with pytest.raises(ApprovalError):
        snapshot_hash(changed)


def test_payload_mutation_rejected_before_signature_check():
    payload = approval_payload(VECTOR, chain_id=84532, contract_address=CONTRACT)
    payload["typed_data"]["message"]["totalKrw"] += 1
    with pytest.raises(ApprovalError, match="typed data differs"):
        verify_approval_signature(payload, "0x" + "00" * 65, VECTOR["buyer_wallet"], chain_id=84532, contract_address=CONTRACT, now=1893499100)
