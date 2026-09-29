from __future__ import annotations

from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi.testclient import TestClient
from web3 import Web3

from backend.agent import MockAgent
from backend.config import Settings
from backend.main import create_app


@pytest.fixture
def demo(tmp_path):
    accounts = {name: Account.create() for name in (
        "buyer-demo", "seller-demo-1", "seller-demo-2", "seller-demo-3",
    )}
    actors = {
        actor_id: {"role": "buyer" if actor_id == "buyer-demo" else "seller",
                   "wallet_address": account.address}
        for actor_id, account in accounts.items()
    }
    settings = Settings(database_path=str(tmp_path / "api.sqlite3"), actors=actors)
    app = create_app(settings)
    with TestClient(app) as client:
        yield app, client, accounts


def login(client: TestClient, actor_id: str) -> tuple[str, dict]:
    response = client.post("/api/demo/sessions", json={"actor_id": actor_id})
    assert response.status_code == 200, response.text
    session = response.json()
    return session["access_token"], session


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_intent(client: TestClient, token: str, max_total: int = 2_400_000) -> dict:
    deadline = (datetime.now(timezone.utc) + timedelta(days=10)).replace(microsecond=0)
    response = client.post("/api/buyer-intents", headers=headers(token), json={
        "gpu_model": "RTX 4090",
        "max_total_krw": max_total,
        "delivery_deadline": deadline.isoformat().replace("+00:00", "Z"),
        "must_have": ["evidence_present"],
    })
    assert response.status_code == 201, response.text
    return response.json()


def sign(typed_data: dict, account) -> str:
    return Web3.to_hex(Account.sign_message(
        encode_typed_data(full_message=typed_data), account.key,
    ).signature)


def start_negotiation(client: TestClient, token: str, intent_id: str, key="test-flow-1") -> dict:
    response = client.post(
        "/api/negotiations",
        headers={**headers(token), "Idempotency-Key": key},
        json={"buyer_intent_id": intent_id},
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_full_mock_flow_requires_both_signatures_and_never_claims_chain_record(demo):
    app, client, accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)
    started = start_negotiation(client, buyer_token, intent["id"])

    repeated = start_negotiation(client, buyer_token, intent["id"])
    assert repeated["id"] == started["id"]
    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).json()
    assert negotiation["status"] == "AWAITING_APPROVALS"
    assert negotiation["agreement_id"]
    assert negotiation["offers"]
    assert all(offer["round"] == 1 and offer["proposer"] == "buyer"
               for offer in negotiation["offers"])
    assert all("min_item_price_krw" not in offer and "seller_wallet" not in offer
               for offer in negotiation["offers"])

    agreement_id = negotiation["agreement_id"]
    agreement = client.get(f"/api/agreements/{agreement_id}", headers=headers(buyer_token)).json()
    assert agreement["snapshot"]["buyer_wallet"] == accounts["buyer-demo"].address.lower()
    assert agreement["snapshot"]["total_krw"] == (
        agreement["snapshot"]["item_price_krw"] + agreement["snapshot"]["shipping_fee_krw"]
    )
    buyer_payload = client.get(
        f"/api/agreements/{agreement_id}/approval-payload", headers=headers(buyer_token),
    ).json()
    assert buyer_payload["snapshot_hash"] == agreement["snapshot_hash"]
    buyer_signature = sign(buyer_payload["typed_data"], accounts["buyer-demo"])
    buyer_decision = client.post(
        f"/api/agreements/{agreement_id}/decisions",
        headers=headers(buyer_token),
        json={"decision": "approve", "snapshot_hash": agreement["snapshot_hash"],
              "signature": buyer_signature},
    )
    assert buyer_decision.status_code == 200, buyer_decision.text
    assert buyer_decision.json()["status"] == "AWAITING_APPROVALS"
    assert buyer_decision.json()["buyer_approved"] is True
    assert buyer_decision.json()["seller_approved"] is False

    seller_id = agreement["snapshot"]["seller_id"]
    seller_token, _ = login(client, seller_id)
    seller_payload = client.get(
        f"/api/agreements/{agreement_id}/approval-payload", headers=headers(seller_token),
    ).json()
    assert seller_payload["typed_data"] == buyer_payload["typed_data"]
    seller_signature = sign(seller_payload["typed_data"], accounts[seller_id])
    seller_body = {"decision": "approve", "snapshot_hash": agreement["snapshot_hash"],
                   "signature": seller_signature}
    final = client.post(
        f"/api/agreements/{agreement_id}/decisions", headers=headers(seller_token), json=seller_body,
    )
    assert final.status_code == 200, final.text
    assert final.json()["status"] == "MOCK_RECORDED"
    assert final.json()["chain"]["mode"] == "mock"
    assert final.json()["chain"]["tx_hash"] is None

    retry = client.post(
        f"/api/agreements/{agreement_id}/decisions", headers=headers(seller_token), json=seller_body,
    )
    assert retry.status_code == 200
    assert retry.json()["status"] == "MOCK_RECORDED"
    audit = client.get(f"/api/flows/{started['flow_id']}/audit", headers=headers(buyer_token)).json()
    assert audit["totals"]["usage_source"] == "mock"
    assert audit["totals"]["calls"] == 0
    assert any(event["event_type"] == "MOCK_RECORD_ONLY" for event in audit["events"])
    event_types = [event["event_type"] for event in audit["events"]]
    assert event_types.index("NEGOTIATION_STARTED") < event_types.index("OFFER_ALLOWED")
    assert event_types.index("OFFER_ALLOWED") < event_types.index("AGREEMENT_CREATED")
    assert all("details" not in event for event in audit["events"])
    assert app.state.settings.chain_mode == "mock"


def test_counter_offer_is_not_selected_until_buyer_agent_accepts(demo):
    app, client, _accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)

    class CounterAgent(MockAgent):
        def buyer_offer(self, intent, listing, assessment):
            return {
                "item_price_krw": 1_850_000,
                "delivery_by": listing["private_policy"]["earliest_delivery_at"],
                "warranty_terms": "판매자 주장 보증",
            }, None

        def seller_reply(self, listing, buyer_offer):
            return {"action": "counter", "item_price_krw": max(
                listing["private_policy"]["min_item_price_krw"], 1_900_000,
            )}, None

    app.state.agent = CounterAgent()
    started = start_negotiation(client, buyer_token, intent["id"], "counter-flow")
    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).json()
    assert negotiation["status"] == "AWAITING_APPROVALS"
    assert negotiation["offers"]
    assert all(offer["round"] == 2 and offer["proposer"] == "seller"
               for offer in negotiation["offers"])
    assert negotiation["offers"][0]["item_price_krw"] >= 1_900_000
    assert all("seller_id" not in offer and "assessment" not in offer for offer in negotiation["offers"])


def test_rejected_counter_does_not_create_an_agreement(demo):
    app, client, _accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)

    class RejectCounterAgent(MockAgent):
        def buyer_offer(self, intent, listing, assessment):
            return {
                "item_price_krw": 1_850_000,
                "delivery_by": listing["private_policy"]["earliest_delivery_at"],
                "warranty_terms": "판매자 주장 보증",
            }, None

        def seller_reply(self, listing, buyer_offer):
            return {"action": "counter", "item_price_krw": max(
                listing["private_policy"]["min_item_price_krw"], 1_900_000,
            )}, None

        def buyer_reply(self, intent, listing, assessment, buyer_offer, seller_counter):
            return {"action": "reject"}, None

    app.state.agent = RejectCounterAgent()
    started = start_negotiation(client, buyer_token, intent["id"], "reject-counter-flow")
    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).json()
    assert negotiation["status"] == "BLOCKED"
    assert negotiation["offers"] == []
    assert negotiation["agreement_id"] is None
    assert {event["reason_code"] for event in negotiation["blocked_events"]} == {
        "BUYER_REJECTED_COUNTER",
    }


def test_candidates_outside_budget_are_blocked_without_exposing_seller_floor(demo):
    _app, client, _accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token, max_total=1_890_000)
    started = start_negotiation(client, buyer_token, intent["id"], "too-low-budget")
    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).json()
    assert negotiation["status"] == "BLOCKED"
    assert negotiation["offers"] == []
    assert {item["reason_code"] for item in negotiation["blocked_events"]} == {"BUDGET_EXCEEDED"}
    assert "min_item_price_krw" not in client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).text


def test_session_role_ownership_and_idempotency_conflicts_are_enforced(demo):
    _app, client, _accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    seller_one, _ = login(client, "seller-demo-1")
    intent = create_intent(client, buyer_token)
    changed_intent = create_intent(client, buyer_token, max_total=2_300_000)
    listing_payload = {
        "gpu_model": "RTX 4090", "asking_price_krw": 1_990_000,
        "min_item_price_krw": 1_900_000, "shipping_fee_krw": 10_000,
        "earliest_delivery_at": (datetime.now(timezone.utc) + timedelta(days=2)).replace(
            microsecond=0,
        ).isoformat().replace("+00:00", "Z"),
        "condition_text": "sample listing", "warranty_end": "2027-01-31",
        "stock_status": "available", "evidence_ids": ["evidence-04"],
    }
    wrong_evidence = client.post("/api/listings", headers=headers(seller_one), json=listing_payload)
    assert wrong_evidence.status_code == 422
    assert wrong_evidence.json()["error"]["code"] == "EVIDENCE_NOT_OWNED"

    started = start_negotiation(client, buyer_token, intent["id"], "idempotency-conflict")
    conflict = client.post(
        "/api/negotiations",
        headers={**headers(buyer_token), "Idempotency-Key": "idempotency-conflict"},
        json={"buyer_intent_id": changed_intent["id"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(seller_one),
    )
    assert negotiation.status_code == 403


def test_live_configuration_does_not_enable_demo_login_by_default(tmp_path):
    settings = Settings(
        mode="live", chain_mode="live", allow_demo_sessions=False,
        database_path=str(tmp_path / "live.sqlite3"),
    )
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/demo/sessions", json={"actor_id": "buyer-demo"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DEMO_SESSIONS_DISABLED"


def test_simultaneous_buyer_and_seller_approvals_do_not_overwrite_each_other(demo):
    _app, client, accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)
    started = start_negotiation(client, buyer_token, intent["id"], "concurrent-approvals")
    negotiation = client.get(
        f"/api/negotiations/{started['id']}", headers=headers(buyer_token),
    ).json()
    agreement_id = negotiation["agreement_id"]
    agreement = client.get(
        f"/api/agreements/{agreement_id}", headers=headers(buyer_token),
    ).json()
    seller_id = agreement["snapshot"]["seller_id"]
    seller_token, _ = login(client, seller_id)
    payload = client.get(
        f"/api/agreements/{agreement_id}/approval-payload", headers=headers(buyer_token),
    ).json()
    common = {"decision": "approve", "snapshot_hash": agreement["snapshot_hash"]}
    buyer_body = {**common, "signature": sign(payload["typed_data"], accounts["buyer-demo"])}
    seller_body = {**common, "signature": sign(payload["typed_data"], accounts[seller_id])}

    with ThreadPoolExecutor(max_workers=2) as pool:
        buyer_future = pool.submit(
            client.post, f"/api/agreements/{agreement_id}/decisions",
            headers=headers(buyer_token), json=buyer_body,
        )
        seller_future = pool.submit(
            client.post, f"/api/agreements/{agreement_id}/decisions",
            headers=headers(seller_token), json=seller_body,
        )
        results = [buyer_future.result(), seller_future.result()]

    assert all(response.status_code == 200 for response in results)
    final = client.get(f"/api/agreements/{agreement_id}", headers=headers(buyer_token)).json()
    assert final["status"] == "MOCK_RECORDED"
    assert final["buyer_approved"] is True
    assert final["seller_approved"] is True
