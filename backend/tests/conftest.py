from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Event, Lock
from typing import Any

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi.testclient import TestClient

from blockchain.adapter import ChainError
from blockchain.signing import approval_payload
from backend.config import BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CONTRACT, Settings
from backend.main import create_app
from backend.repository import SQLiteAgreementRepository


def sign(account: Any, typed_data: dict[str, Any]) -> str:
    message = encode_typed_data(full_message=typed_data)
    signature = Account.sign_message(message, private_key=account.key).signature.hex()
    return signature if signature.startswith("0x") else f"0x{signature}"


def make_snapshot(buyer_wallet: str, seller_wallet: str, *, nonce: int = 1,
                  expires_at: str | None = None, agreement_id: str = "agreement-test-1") -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    delivery_by = (now + timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    expiry = expires_at or (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "snapshot_version": 1,
        "agreement_id": agreement_id,
        "offer_id": "offer-test-1",
        "listing_id": "listing-test-1",
        "seller_id": "seller-demo",
        "gpu_model": "RTX 3070",
        "item_price_krw": 450000,
        "shipping_fee_krw": 10000,
        "total_krw": 460000,
        "delivery_by": delivery_by,
        "warranty_terms": "Seller warranty through 2027-01-31",
        "evidence_hashes": [],
        "buyer_wallet": buyer_wallet.lower(),
        "seller_wallet": seller_wallet.lower(),
        "expires_at": expiry,
        "nonce": nonce,
    }


class WaitingFailChain:
    """Test boundary: count one submission attempt, then stop before any tx/hash exists."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.lock = Lock()
        self.entered = Event()
        self.release = Event()

    def record_agreement(self, agreement, buyer_signature, seller_signature, *, persist_tx_hash, previous_tx_hash=None):
        with self.lock:
            self.calls.append({"agreement": agreement, "previous_tx_hash": previous_tx_hash})
        self.entered.set()
        self.release.wait(timeout=10)
        raise ChainError("test boundary stopped before broadcast")

    def get_record(self, tx_hash: str, agreement_hash: str) -> dict[str, Any]:
        return {"status": "pending", "tx_hash": tx_hash}


class PreviousHashChain:
    def __init__(self) -> None:
        self.previous_hashes: list[str | None] = []

    def record_agreement(self, agreement, buyer_signature, seller_signature, *, persist_tx_hash, previous_tx_hash=None):
        self.previous_hashes.append(previous_tx_hash)
        return {"status": "previous_submission", "tx_hash": previous_tx_hash,
                "record": {"status": "pending", "tx_hash": previous_tx_hash}}

    def get_record(self, tx_hash: str, agreement_hash: str) -> dict[str, Any]:
        return {"status": "pending", "tx_hash": tx_hash}


class ExistingRecordChain:
    def __init__(self, record: dict[str, Any]) -> None:
        self.record = record
        self.previous_hashes: list[str | None] = []

    def record_agreement(self, agreement, buyer_signature, seller_signature, *, persist_tx_hash, previous_tx_hash=None):
        self.previous_hashes.append(previous_tx_hash)
        return {"status": "previous_submission", "tx_hash": previous_tx_hash, "record": self.record}

    def get_record(self, tx_hash: str, agreement_hash: str) -> dict[str, Any]:
        return self.record


@dataclass
class TestSystem:
    client: TestClient
    buyer: Any
    seller: Any
    settings: Settings
    repository: SQLiteAgreementRepository
    agreement_id: str
    buyer_token: str
    seller_token: str

    @property
    def buyer_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.buyer_token}"}

    @property
    def seller_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.seller_token}"}

    def payload(self, *, actor: str = "buyer", agreement_id: str | None = None) -> dict[str, Any]:
        headers = self.buyer_headers if actor == "buyer" else self.seller_headers
        response = self.client.get(
            f"/api/agreements/{agreement_id or self.agreement_id}/approval-payload", headers=headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def add_agreement(self, *, agreement_id: str, nonce: int,
                      expires_at: str | None = None) -> dict[str, Any]:
        snapshot = make_snapshot(
            self.buyer.address, self.seller.address, nonce=nonce,
            expires_at=expires_at, agreement_id=agreement_id,
        )
        self.repository.create_agreement(
            agreement_id=agreement_id, flow_id=f"flow-{agreement_id}",
            offer_id=snapshot["offer_id"], snapshot=snapshot,
        )
        return snapshot


def make_system(tmp_path, *, relayer_private_key: str | None = None,
                chain_factory=None, expiry: str | None = None) -> TestSystem:
    buyer = Account.create()
    seller = Account.create()
    settings = Settings(
        database_path=tmp_path / "agreements.sqlite3",
        chain_id=BASE_SEPOLIA_CHAIN_ID,
        contract_address=BASE_SEPOLIA_CONTRACT,
        relayer_private_key=relayer_private_key,
        buyer_demo_wallet=buyer.address.lower(),
        seller_demo_wallet=seller.address.lower(),
    )
    repository = SQLiteAgreementRepository(settings.database_path)
    app = create_app(settings=settings, repository=repository, chain_factory=chain_factory)
    client = TestClient(app)
    snapshot = make_snapshot(buyer.address, seller.address, expires_at=expiry)
    repository.create_agreement(
        agreement_id=snapshot["agreement_id"], flow_id="flow-test-1",
        offer_id=snapshot["offer_id"], snapshot=snapshot,
    )
    buyer_session = client.post("/api/demo/sessions", json={"actor_id": "buyer-demo"})
    seller_session = client.post("/api/demo/sessions", json={"actor_id": "seller-demo"})
    assert buyer_session.status_code == 200, buyer_session.text
    assert seller_session.status_code == 200, seller_session.text
    return TestSystem(
        client=client, buyer=buyer, seller=seller, settings=settings,
        repository=repository, agreement_id=snapshot["agreement_id"],
        buyer_token=buyer_session.json()["access_token"],
        seller_token=seller_session.json()["access_token"],
    )


@pytest.fixture
def system(tmp_path) -> TestSystem:
    return make_system(tmp_path)
