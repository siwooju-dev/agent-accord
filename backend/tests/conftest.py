import sys
import os
from pathlib import Path
from datetime import timedelta
import uuid
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["APP_MODE"] = "mock"
from app.main import create_app
from app.config import Settings
from app import db as m
from app.seed import seed


@pytest.fixture
def rig(tmp_path):
    engine = m.engine_for("sqlite:///" + str(tmp_path / "test.db"))
    m.Base.metadata.create_all(engine)
    seed(engine)
    app = create_app(Settings(), engine=engine)
    with TestClient(app) as client:
        csrf = client.post("/api/v1/session", json={}).json()["csrf_token"]
        client.headers.update({"X-CSRF-Token": csrf})
        yield app, client
    engine.dispose()


def policy(budget=1000000, sellers=None):
    return {"max_total_krw": budget, "min_ram_gb": 16, "min_ssd_gb": 512,
            "allowed_seller_ids": sellers or ["seller-a"], "delivery_by": (m.now() + timedelta(days=7)).date().isoformat(),
            "expires_at": (m.now() + timedelta(hours=1)).isoformat(), "max_rounds": 6}


def post(client, path, body, key=None):
    return client.post(path, json=body, headers={"Idempotency-Key": key or uuid.uuid4().hex})


def create(client, data=None, product="laptop-a"):
    response = post(client, "/api/v1/deals", {"product_id": product, "policy": data or policy()})
    assert response.status_code == 201, response.text
    return response.json()


def start(client, data=None, product="laptop-a"):
    deal = create(client, data, product)
    base = "/api/v1/deals/" + deal["id"]
    assert post(client, base + "/policy/confirm", {"expected_policy_version": 1}).status_code == 200
    response = post(client, base + "/negotiation/start", {"expected_policy_version": 1})
    assert response.status_code == 200, response.text
    return base, response.json()


def approval(deal):
    return {"expected_policy_version": deal["policy_version"], "snapshot_hash": deal["agreement"]["snapshot_hash"]}
