from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import select
import pytest
from app import db as m
from app.config import Settings
from app.auth import issue_credential, verify_credential
from app.main import create_app
from conftest import create, start, post, policy, approval


def test_session_csrf_ownership_and_expiry(rig):
    app, client = rig
    deal = create(client)
    base = "/api/v1/deals/" + deal["id"]
    assert client.post(base + "/policy/confirm", json={"expected_policy_version": 1}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post(base + "/policy/confirm", json={"expected_policy_version": 1}).status_code == 400
    assert post(client, base + "/policy/confirm", {"expected_policy_version": 999}).status_code == 409
    with TestClient(app) as outsider:
        assert outsider.get(base).status_code == 401
        csrf = outsider.post("/api/v1/session", json={}).json()["csrf_token"]
        outsider.headers.update({"X-CSRF-Token": csrf})
        for suffix in ["", "/policy", "/negotiation", "/rounds", "/evidence", "/usage"]:
            assert outsider.get(base + suffix).status_code == 404
        assert post(outsider, base + "/policy/confirm", {"expected_policy_version": 1}).status_code == 404
    with m.write(app.state.engine) as db:
        for session in db.scalars(select(m.AuthSession)): session.expires_at = (m.now() - timedelta(seconds=1)).isoformat()
    assert client.get(base).status_code == 401


def test_idempotency_payload_conflict_and_replay(rig):
    app, client = rig
    body = {"product_id": "laptop-a", "policy": policy()}
    one = post(client, "/api/v1/deals", body, "same")
    two = post(client, "/api/v1/deals", body, "same")
    assert one.json()["id"] == two.json()["id"]
    body["policy"]["max_total_krw"] = 900000
    assert post(client, "/api/v1/deals", body, "same").json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


@pytest.mark.parametrize("change", ["stock", "product_version", "seller_version", "shipping", "expiry", "hash"])
def test_approval_rechecks_snapshot_stock_clock_and_hash(rig, change):
    app, client = rig
    base, deal = start(client)
    with m.write(app.state.engine) as db:
        p = db.get(m.Product, "laptop-a")
        if change == "stock": p.stock = 0
        elif change == "product_version": p.data = p.data | {"product_version": 2}
        elif change == "shipping": p.data = p.data | {"shipping_fee_krw": 20000}
        elif change == "seller_version": db.get(m.SellerPolicy, "laptop-a").version = 2
        elif change == "expiry":
            row = db.scalar(select(m.PolicyRow))
            row.data = row.data | {"expires_at": (m.now() - timedelta(seconds=1)).isoformat()}
    body = approval(deal)
    if change == "hash": body["snapshot_hash"] = "f" * 64
    assert post(client, base + "/agreement/approve", body).json()["error"]["code"] == "APPROVAL_STALE"
    assert client.get(base).json()["status"] == "BLOCKED"
    assert client.get(base + "/evidence").json()["events"][-1]["event_type"] == "APPROVAL_BLOCK"


def test_live_requires_authenticated_credentials_and_no_mock_fallback(rig):
    app, client = rig
    settings = Settings(mode="live", kiln_base_url="https://provider.invalid/v1", kiln_api_key="test-placeholder",
        kiln_model="gpt-oss-120b", auth_secret="s" * 40, allowed_origin="https://demo.invalid", chain_mode="evm",
        chain_network="testnet", chain_id=12345, chain_allowed_ids="12345", chain_evidence="local-test-only",
        chain_rpc="https://rpc.invalid", chain_contract="0x" + "1" * 40, relayer_key="0x" + "2" * 64)
    live = create_app(settings, engine=app.state.engine)
    with TestClient(live, base_url="https://demo.invalid") as user:
        assert user.post("/api/v1/session", json={}).status_code == 401
        credential = issue_credential(settings.auth_secret, "buyer-test")
        assert user.post("/api/v1/session", json={"credential": credential}).status_code == 201
        assert user.get("/api/v1/session").status_code == 200
        assert "Secure" in user.post("/api/v1/session", json={"credential": credential}).headers["set-cookie"]
    assert verify_credential(settings.auth_secret, credential + "bad") is None
    assert verify_credential(settings.auth_secret, issue_credential(settings.auth_secret, "expired", -1)) is None
    with pytest.raises(ValueError): create_app(Settings(mode="live"))
    with pytest.raises(ValueError): Settings(chain_mode="evm").validate()


def test_integer_money_and_timezone_validation(rig):
    _, client = rig
    for field, value in [("max_total_krw", 1000000.0), ("max_total_krw", True), ("max_total_krw", -1), ("expires_at", "2030-01-01T00:00:00")]:
        data = policy()
        data[field] = value
        assert post(client, "/api/v1/deals", {"product_id": "laptop-a", "policy": data}).status_code == 422
