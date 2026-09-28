import json
import sys
import tempfile
from datetime import timedelta
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import create_app
from app.config import Settings
from app.db import Base, now, engine_for
from app.seed import seed


def run():
    with tempfile.TemporaryDirectory() as folder:
        engine = engine_for("sqlite:///" + str(Path(folder) / "demo.db"))
        Base.metadata.create_all(engine)
        seed(engine)
        app = create_app(Settings(), engine=engine)
        with TestClient(app) as client:
            csrf = client.post("/api/v1/session", json={}).json()["csrf_token"]
            def post(path, body):
                import uuid
                return client.post(path, json=body, headers={"X-CSRF-Token": csrf, "Idempotency-Key": uuid.uuid4().hex})
            outcomes = []
            for label, budget, sellers in [("A", 1000000, ["seller-a"]), ("B", 900000, ["seller-a"]), ("C", 1000000, ["seller-b"])]:
                policy = {"max_total_krw": budget, "min_ram_gb": 16, "min_ssd_gb": 512, "allowed_seller_ids": sellers,
                          "delivery_by": (now() + timedelta(days=7)).date().isoformat(), "expires_at": (now() + timedelta(hours=1)).isoformat()}
                deal = post("/api/v1/deals", {"product_id": "laptop-a", "policy": policy}).json()
                base = "/api/v1/deals/" + deal["id"]
                post(base + "/policy/confirm", {"expected_policy_version": 1})
                deal = post(base + "/negotiation/start", {"expected_policy_version": 1}).json()
                if deal["agreement"]:
                    result = post(base + "/agreement/approve", {"expected_policy_version": 1, "snapshot_hash": deal["agreement"]["snapshot_hash"]})
                    assert result.status_code == 202
                deal = client.get(base).json()
                usage = client.get(base + "/usage").json()
                outcomes.append({"scenario": label, "mode": "mock", "status": deal["status"], "reason_codes": deal["reason_codes"],
                                 "agreed_total_krw": deal["agreement"]["snapshot"]["total_krw"] if deal["agreement"] else None,
                                 "usage": usage, "chain": deal["chain"]})
            print(json.dumps(outcomes, indent=2, ensure_ascii=False))
        engine.dispose()


if __name__ == "__main__": run()
