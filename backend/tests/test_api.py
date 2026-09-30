from __future__ import annotations

import json

from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import stat

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from fastapi.testclient import TestClient
from web3 import Web3

from backend.agent import KilnAgent, MockAgent
from backend.config import Settings
from backend.main import create_app
from backend.store import Store


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
    with TestClient(app, base_url="http://localhost") as client:
        yield app, client, accounts


def login(client: TestClient, actor_id: str) -> tuple[str, dict]:
    response = client.post("/api/demo/sessions", json={"actor_id": actor_id})
    assert response.status_code == 200, response.text
    session = response.json()
    return session["access_token"], session


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def wallet_login(client: TestClient, account, role: str) -> dict:
    origin = str(client.base_url).rstrip("/")
    challenge = client.post(
        "/api/auth/challenges", headers={"Origin": origin},
        json={"wallet_address": account.address, "role": role},
    )
    assert challenge.status_code == 201, challenge.text
    message = challenge.json()["message"]
    signature = Web3.to_hex(Account.sign_message(encode_defunct(text=message), account.key).signature)
    response = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge.json()["challenge_id"], "signature": signature},
    )
    assert response.status_code == 200, response.text
    return response.json()


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


def test_wallet_session_requires_one_time_signed_challenge_for_selected_role(demo):
    _, client, _ = demo
    account = Account.create()
    origin = str(client.base_url).rstrip("/")
    challenge_response = client.post(
        "/api/auth/challenges", headers={"Origin": origin},
        json={"wallet_address": account.address, "role": "buyer"},
    )
    assert challenge_response.status_code == 201, challenge_response.text
    challenge = challenge_response.json()
    signature = Web3.to_hex(Account.sign_message(encode_defunct(text=challenge["message"]), account.key).signature)
    response = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge["challenge_id"], "signature": signature},
    )
    session = response.json()

    assert response.status_code == 200, response.text
    assert session["role"] == "buyer"
    assert session["wallet_address"].lower() == account.address.lower()
    assert session["access_token"]

    retry = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge["challenge_id"], "signature": signature},
    )
    assert retry.status_code == 401


def test_wallet_auth_rate_limit_isolated_per_client(demo):
    app, _, _ = demo
    origin = "http://localhost"
    first, second = Account.create(), Account.create()
    with TestClient(app, base_url=origin, client=("198.51.100.10", 5000)) as first_client:
        for _ in range(20):
            response = first_client.post(
                "/api/auth/challenges",
                headers={"Origin": origin, "X-Accord-Client-IP": "203.0.113.99"},
                json={"wallet_address": first.address, "role": "buyer"},
            )
            assert response.status_code == 201, response.text
        blocked = first_client.post(
            "/api/auth/challenges", headers={"Origin": origin},
            json={"wallet_address": first.address, "role": "buyer"},
        )
    with TestClient(app, base_url=origin, client=("198.51.100.11", 5001)) as other_client:
        other_wallet = other_client.post(
            "/api/auth/challenges", headers={"Origin": origin},
            json={"wallet_address": first.address, "role": "buyer"},
        )
        other_wallet_also_allowed = other_client.post(
            "/api/auth/challenges", headers={"Origin": origin},
            json={"wallet_address": second.address, "role": "buyer"},
        )

    assert blocked.status_code == 429
    assert other_wallet.status_code == 201
    assert other_wallet_also_allowed.status_code == 201


def test_wallet_session_rejects_wrong_signer_without_consuming_challenge(demo):
    _, client, _ = demo
    owner, attacker = Account.create(), Account.create()
    origin = str(client.base_url).rstrip("/")
    challenge_response = client.post(
        "/api/auth/challenges", headers={"Origin": origin},
        json={"wallet_address": owner.address, "role": "seller"},
    )
    assert challenge_response.status_code == 201, challenge_response.text
    challenge = challenge_response.json()
    wrong = Web3.to_hex(Account.sign_message(encode_defunct(text=challenge["message"]), attacker.key).signature)
    rejected = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge["challenge_id"], "signature": wrong},
    )
    assert rejected.status_code == 401

    correct = Web3.to_hex(Account.sign_message(encode_defunct(text=challenge["message"]), owner.key).signature)
    accepted = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge["challenge_id"], "signature": correct},
    )
    assert accepted.status_code == 200
    assert accepted.json()["role"] == "seller"


def test_wallet_auth_rejects_cross_origin_challenge(demo):
    _, client, _ = demo
    response = client.post(
        "/api/auth/challenges", headers={"Origin": "https://attacker.example"},
        json={"wallet_address": Account.create().address, "role": "buyer"},
    )
    assert response.status_code == 403


def test_wallet_challenge_expiry_is_enforced(demo):
    app, client, _ = demo
    account = Account.create()
    origin = str(client.base_url).rstrip("/")
    challenge = client.post(
        "/api/auth/challenges", headers={"Origin": origin},
        json={"wallet_address": account.address, "role": "buyer"},
    ).json()
    signature = Web3.to_hex(Account.sign_message(
        encode_defunct(text=challenge["message"]), account.key,
    ).signature)
    with app.state.store.transaction() as conn:
        conn.execute(
            "UPDATE auth_challenges SET expires_at=? WHERE challenge_id=?",
            ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), challenge["challenge_id"]),
        )

    response = client.post(
        "/api/auth/sessions", headers={"Origin": origin},
        json={"challenge_id": challenge["challenge_id"], "signature": signature},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_CHALLENGE_INVALID"


def test_health_does_not_echo_provider_url_credentials(tmp_path):
    secret = "health-test-secret-never-return"
    settings = Settings(
        database_path=str(tmp_path / "health.sqlite3"),
        kiln_base_url=f"https://user:{secret}@provider.example/v1?token={secret}",
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["contract_version"] == "0.2"
    assert secret not in response.text
    assert "base_url" not in response.json()["kiln"]


def test_wallet_identity_authorizes_role_and_public_listing_catalog(demo):
    _, client, _ = demo
    buyer = wallet_login(client, Account.create(), "buyer")
    seller = wallet_login(client, Account.create(), "seller")
    buyer_headers = headers(buyer["access_token"])
    seller_headers = headers(seller["access_token"])

    intent = create_intent(client, buyer["access_token"])
    started = start_negotiation(client, buyer["access_token"], intent["id"], "wallet-flow")
    negotiation = client.get(f"/api/negotiations/{started['id']}", headers=buyer_headers).json()
    assert negotiation["agreement_id"]
    agreement = client.get(
        f"/api/agreements/{negotiation['agreement_id']}", headers=buyer_headers,
    ).json()
    assert agreement["snapshot"]["buyer_wallet"].lower() == buyer["wallet_address"].lower()
    listing_body = {
        "gpu_model": "RTX 4090", "asking_price_krw": 1_950_000,
        "min_item_price_krw": 1_800_000, "shipping_fee_krw": 20_000,
        "earliest_delivery_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        "condition_text": "demo listing", "warranty_end": None,
        "stock_status": "available", "evidence_ids": [],
    }
    denied = client.post("/api/listings", headers=buyer_headers, json=listing_body)
    assert denied.status_code == 403

    catalog = client.get("/api/listings")
    assert catalog.status_code == 200
    items = catalog.json()["items"]
    assert len(items) >= 3
    assert all(item["source"] == "demo" for item in items[:3])
    assert all("private_policy" not in item and "seller_wallet" not in item for item in items)

    created = client.post("/api/listings", headers=seller_headers, json=listing_body)
    assert created.status_code == 201, created.text
    assert created.json()["seller_id"]


def test_live_mode_disables_impersonated_demo_sessions(tmp_path):
    buyer, seller = Account.create(), Account.create()
    settings = Settings(
        mode="live", chain_mode="live", allow_demo_sessions=False,
        database_path=str(tmp_path / "live.sqlite3"), actors={
            "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
            "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
        },
    )
    with TestClient(create_app(settings), base_url="http://localhost") as client:
        response = client.post("/api/demo/sessions", json={"actor_id": "buyer-demo"})
    assert response.status_code == 403


def test_live_settings_reject_mock_chain_and_demo_session_overrides():
    buyer, seller = Account.create(), Account.create()
    actors = {
        "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
        "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
    }
    with pytest.raises(ValueError, match="CHAIN_MODE=live requires APP_MODE=live"):
        Settings(mode="mock", chain_mode="live", chain_id=1).validate()
    with pytest.raises(ValueError, match="chain ID 84532"):
        Settings(mode="live", chain_mode="live", chain_id=1, actors=actors).validate()
    with pytest.raises(ValueError, match="does not allow demo sessions"):
        Settings(mode="live", chain_mode="live", actors=actors, allow_demo_sessions=True).validate()


def test_auth_challenge_limit_uses_only_loopback_proxy_identity(tmp_path):
    buyer, seller = Account.create(), Account.create()
    actors = {
        "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
        "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
    }
    origin = "http://localhost"
    app = create_app(Settings(database_path=str(tmp_path / "proxy-limits.sqlite3"), actors=actors))
    body = {"wallet_address": buyer.address, "role": "buyer"}
    with TestClient(app, base_url=origin, client=("127.0.0.1", 5000)) as first_proxy:
        statuses = [first_proxy.post(
            "/api/auth/challenges",
            headers={"Origin": origin, "X-Accord-Client-IP": "198.51.100.20"},
            json=body,
        ).status_code for _ in range(21)]
    with TestClient(app, base_url=origin, client=("127.0.0.1", 5001)) as second_proxy:
        other_proxy_client = second_proxy.post(
            "/api/auth/challenges",
            headers={"Origin": origin, "X-Accord-Client-IP": "198.51.100.21"},
            json=body,
        )
    assert statuses[:20] == [201] * 20
    assert statuses[20] == 429
    assert other_proxy_client.status_code == 201


def test_live_wallet_auth_only_accepts_configured_role_wallets(tmp_path):
    buyer, seller, unknown = Account.create(), Account.create(), Account.create()
    settings = Settings(
        mode="live", chain_mode="live", allow_demo_sessions=False,
        database_path=str(tmp_path / "live-wallets.sqlite3"), actors={
            "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
            "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
        },
    )
    origin = "http://localhost"
    with TestClient(create_app(settings), base_url=origin) as client:
        denied = client.post(
            "/api/auth/challenges", headers={"Origin": origin},
            json={"wallet_address": unknown.address, "role": "buyer"},
        )
        allowed = client.post(
            "/api/auth/challenges", headers={"Origin": origin},
            json={"wallet_address": buyer.address, "role": "buyer"},
        )

    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "AUTH_WALLET_NOT_ALLOWED"
    assert allowed.status_code == 201


def test_live_settings_pin_base_sepolia_and_distinct_demo_roles(tmp_path):
    buyer, seller = Account.create(), Account.create()
    actors = {
        "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
        "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
    }
    with pytest.raises(ValueError, match="chain ID 84532"):
        Settings(mode="live", chain_mode="live", chain_id=1, actors=actors).validate()
    with pytest.raises(ValueError, match="explicitly configured demo wallets"):
        Settings(mode="live", chain_mode="live", allow_demo_sessions=False).validate()
    with pytest.raises(ValueError, match="distinct configured buyer and seller wallets"):
        Settings(mode="live", chain_mode="live", allow_demo_sessions=False, actors={
            "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
            "seller-demo-1": {"role": "seller", "wallet_address": buyer.address},
        }).validate()


def test_live_buyer_negotiations_are_bounded_per_hour(tmp_path):
    buyer, seller = Account.create(), Account.create()
    settings = Settings(
        mode="live", chain_mode="live", allow_demo_sessions=False, negotiations_per_hour=3,
        database_path=str(tmp_path / "live-quota.sqlite3"), actors={
            "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
            "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
        },
    )
    app = create_app(settings)
    app.state.agent = MockAgent()
    with TestClient(app, base_url="http://localhost") as client:
        session = wallet_login(client, buyer, "buyer")
        intent = create_intent(client, session["access_token"])
        for index in range(3):
            started = client.post(
                "/api/negotiations",
                headers={**headers(session["access_token"]), "Idempotency-Key": f"quota-{index}"},
                json={"buyer_intent_id": intent["id"]},
            )
            assert started.status_code == 202, started.text
        denied = client.post(
            "/api/negotiations",
            headers={**headers(session["access_token"]), "Idempotency-Key": "quota-overflow"},
            json={"buyer_intent_id": intent["id"]},
        )

    assert denied.status_code == 429
    assert denied.json()["error"]["code"] == "NEGOTIATION_RATE_LIMITED"


def test_database_and_kiln_log_files_have_owner_only_permissions(tmp_path):
    database = tmp_path / "private" / "api.sqlite3"
    store = Store(str(database))
    log_path = database.parent / "kiln_calls.jsonl"
    agent = KilnAgent(Settings(kiln_log_path=str(log_path)))
    agent._log({"outcome": "test"})

    assert database.stat().st_mode & 0o777 == 0o600
    assert log_path.stat().st_mode & 0o777 == 0o600


def test_demo_seed_adds_missing_fixtures_without_replacing_existing_listings(tmp_path):
    sellers = {f"seller-demo-{index}": Account.create() for index in (1, 2, 3)}
    actors = {
        actor_id: {"role": "seller", "wallet_address": account.address}
        for actor_id, account in sellers.items()
    }
    store = Store(str(tmp_path / "seed.sqlite3"))
    with store.transaction() as conn:
        store.put("listing", "user-listing", "wallet-seller-test", {"title": "Keep me"}, conn)

    store.seed_demo_listings(actors)
    rows = store.list("listing")

    assert {row["id"] for row in rows} == {
        "user-listing", "listing-demo-1", "listing-demo-2", "listing-demo-3",
    }
    assert store.get("listing", "user-listing")["title"] == "Keep me"


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
    assert all(entry["actor"] in {"buyer", "seller"} for entries in negotiation["transcripts"].values() for entry in entries)
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
    assert {item["reason_code"] for item in negotiation["blocked_events"]} == {"CANDIDATE_UNAVAILABLE"}
    audit = client.get(f"/api/flows/{started['flow_id']}/audit", headers=headers(buyer_token)).json()
    private_candidate_events = [event for event in audit["events"] if event["event_type"] == "CANDIDATE_BLOCKED"]
    assert private_candidate_events
    assert all(event["reason_code"] == "CANDIDATE_UNAVAILABLE" for event in private_candidate_events)
    assert all(event["object_id"] is None for event in private_candidate_events)
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
    buyer, seller = Account.create(), Account.create()
    settings = Settings(
        mode="live", chain_mode="live", allow_demo_sessions=False,
        database_path=str(tmp_path / "live.sqlite3"),
        actors={
            "buyer-demo": {"role": "buyer", "wallet_address": buyer.address},
            "seller-demo-1": {"role": "seller", "wallet_address": seller.address},
        },
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


def test_logout_revokes_the_server_session(demo):
    _app, client, _accounts = demo
    token, _ = login(client, "buyer-demo")
    auth = headers(token)

    assert client.get("/api/agreements", headers=auth).status_code == 200
    logged_out = client.post("/api/auth/logout", headers=auth)
    assert logged_out.status_code == 200
    assert logged_out.json()["revoked"] is True
    expired = client.get("/api/agreements", headers=auth)
    assert expired.status_code == 401
    assert expired.json()["error"]["code"] == "SESSION_REQUIRED"


def test_flow_script_wallet_login_uses_signed_wallet_challenge(demo, monkeypatch):
    _app, client, accounts = demo
    from scripts import run_flows

    monkeypatch.setattr(run_flows, "BASE", str(client.base_url).rstrip("/"))
    auth = run_flows.wallet_login(client, "buyer-demo", accounts["buyer-demo"].key.hex())

    assert auth["Authorization"].startswith("Bearer ")
    assert client.get("/api/agreements", headers=auth).status_code == 200


def test_flow_script_test_wallet_file_is_owner_only(tmp_path, monkeypatch):
    from scripts import run_flows

    wallet_path = tmp_path / "private" / "test_wallets.json"
    monkeypatch.setattr(run_flows, "WALLETS", wallet_path)

    generated = run_flows.wallets()

    assert set(generated) == set(run_flows.ACTORS)
    assert stat.S_IMODE(wallet_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(wallet_path.parent.stat().st_mode) == 0o700


def test_flow_script_hardens_existing_test_wallet_file(tmp_path, monkeypatch):
    from eth_account import Account
    from scripts import run_flows

    wallet_path = tmp_path / "private" / "test_wallets.json"
    wallet_path.parent.mkdir(mode=0o755)
    keys = {actor: "0x" + Account.create().key.hex().removeprefix("0x") for actor in run_flows.ACTORS}
    wallet_path.write_text(json.dumps(keys), encoding="utf-8")
    wallet_path.parent.chmod(0o755)
    wallet_path.chmod(0o644)
    monkeypatch.setattr(run_flows, "WALLETS", wallet_path)

    assert run_flows.wallets() == keys
    assert stat.S_IMODE(wallet_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(wallet_path.parent.stat().st_mode) == 0o700


def test_flow_script_rejects_test_wallet_symlink(tmp_path, monkeypatch):
    from eth_account import Account
    from scripts import run_flows

    wallet_path = tmp_path / "private" / "test_wallets.json"
    wallet_path.parent.mkdir(mode=0o755)
    external_file = tmp_path / "external-wallets.json"
    keys = {actor: "0x" + Account.create().key.hex().removeprefix("0x") for actor in run_flows.ACTORS}
    external_file.write_text(json.dumps(keys), encoding="utf-8")
    external_file.chmod(0o644)
    wallet_path.symlink_to(external_file)
    monkeypatch.setattr(run_flows, "WALLETS", wallet_path)

    with pytest.raises(OSError):
        run_flows.wallets()
    assert stat.S_IMODE(external_file.stat().st_mode) == 0o644


def test_wallet_alias_can_read_seller_audit_without_authorizing_other_seller(demo):
    app, client, accounts = demo
    app.state.settings.actors["seller-demo-2"]["wallet_address"] = accounts["seller-demo-1"].address.lower()
    alias_token, _ = login(client, "seller-demo-1")
    other_token, _ = login(client, "seller-demo-3")
    flow_id, agreement_id = "flow-alias", "agreement-alias"
    with app.state.store.transaction() as conn:
        app.state.store.put("negotiation", "neg-alias", "buyer-demo", {
            "id": "neg-alias", "flow_id": flow_id, "buyer_id": "buyer-demo",
            "agreement_id": agreement_id, "status": "AWAITING_APPROVALS",
        }, conn)
        app.state.store.put("agreement", agreement_id, "buyer-demo", {
            "id": agreement_id, "flow_id": flow_id, "seller_id": "seller-demo-2",
            "status": "AWAITING_APPROVALS",
            "snapshot": {"seller_wallet": accounts["seller-demo-1"].address.lower()},
        }, conn)

    audit = client.get(f"/api/flows/{flow_id}/audit", headers=headers(alias_token))
    denied = client.get(f"/api/flows/{flow_id}/audit", headers=headers(other_token))

    assert audit.status_code == 200, audit.text
    assert denied.status_code == 403


def test_public_rationale_does_not_copy_model_private_reasons(demo):
    app, client, _accounts = demo

    class LeakyAgent(MockAgent):
        def buyer_offer(self, intent, listing, assessment):
            result, usage = super().buyer_offer(intent, listing, assessment)
            return {**result, "reason": "buyer-private-marker"}, usage

        def seller_reply(self, listing, buyer_offer):
            result, usage = super().seller_reply(listing, buyer_offer)
            return {**result, "reason": "seller-floor-marker"}, usage

    app.state.agent = LeakyAgent()
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)
    started = start_negotiation(client, buyer_token, intent["id"], "private-reason-redaction")
    negotiation = client.get(f"/api/negotiations/{started['id']}", headers=headers(buyer_token)).json()

    assert negotiation["offers"]
    assert "buyer-private-marker" not in str(negotiation["offers"])
    assert "seller-floor-marker" not in str(negotiation["offers"])


@pytest.mark.parametrize("matching", [False, True])
def test_live_chain_reconciliation_requires_record_to_match_approved_snapshot(demo, matching):
    app, client, _accounts = demo
    buyer_token, _ = login(client, "buyer-demo")
    intent = create_intent(client, buyer_token)
    started = start_negotiation(client, buyer_token, intent["id"], "chain-record-match")
    negotiation = client.get(f"/api/negotiations/{started['id']}", headers=headers(buyer_token)).json()
    agreement_id = negotiation["agreement_id"]
    agreement = app.state.store.get("agreement", agreement_id)
    tx_hash = "0x" + "12" * 32
    agreement["status"] = "RECORDING"
    agreement["chain"] = {"mode": "testnet", "chain_id": 84532, "tx_hash": tx_hash,
                           "receipt_status": "pending"}
    with app.state.store.transaction() as conn:
        app.state.store.put("agreement", agreement_id, agreement["buyer_id"], agreement, conn)
    object.__setattr__(app.state.settings, "chain_mode", "live")
    object.__setattr__(app.state.settings, "relayer_private_key", "configured-for-test")

    class ChainRecord:
        def get_record(self, _tx_hash, _agreement_hash):
            return {
                "status": "success", "chain_id": 84532, "tx_hash": tx_hash,
                "agreement_hash": agreement["snapshot_hash"],
                "buyer": agreement["snapshot"]["buyer_wallet"] if matching else "0x" + "99" * 20,
                "seller": agreement["snapshot"]["seller_wallet"],
                "total_krw": agreement["snapshot"]["total_krw"],
                "nonce": agreement["snapshot"]["nonce"], "block_number": 1,
            }

    app.state.chain = ChainRecord()
    response = client.get(f"/api/agreements/{agreement_id}", headers=headers(buyer_token))

    assert response.status_code == 200, response.text
    assert response.json()["status"] == ("RECORDED" if matching else "RECORDING")
