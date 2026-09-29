"""Run one negotiation in-process with the real Kiln agents and no chain (throwaway database).

    .venv/bin/python scripts/kiln_smoke.py [--budget 2400000] [--days 10]

Checks the Kiln key, prompts and validation before a live demo. Uses a temporary database and
logs calls to .local/kiln_smoke.jsonl, so nothing here ends up in docs/PROOF.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import Settings, load_local_env  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--budget", type=int, default=2_400_000)
    parser.add_argument("--days", type=int, default=10)
    args = parser.parse_args()
    load_local_env()
    import os

    from eth_account import Account
    from fastapi.testclient import TestClient

    from backend.agent import KilnAgent
    from backend.main import create_app

    if not os.getenv("KILN_API_KEY"):
        print("KILN_API_KEY가 없습니다: scripts/setup_secrets.py", file=sys.stderr)
        return 1
    actors = {name: {"role": "buyer" if name == "buyer-demo" else "seller", "wallet_address": Account.create().address}
              for name in ("buyer-demo", "seller-demo-1", "seller-demo-2", "seller-demo-3")}
    with tempfile.TemporaryDirectory() as tmp:
        base = Settings.from_env()
        settings = Settings(**{**base.__dict__, "mode": "mock", "chain_mode": "mock", "actors": actors,
                               "database_path": str(Path(tmp) / "smoke.sqlite3"),
                               "kiln_log_path": str(ROOT / ".local" / "kiln_smoke.jsonl")})
        app = create_app(settings)
        app.state.agent = KilnAgent(settings)
        with TestClient(app) as client:
            token = client.post("/api/demo/sessions", json={"actor_id": "buyer-demo"}).json()["access_token"]
            auth = {"Authorization": f"Bearer {token}"}
            deadline = (datetime.now(timezone.utc) + timedelta(days=args.days)).replace(microsecond=0)
            intent = client.post("/api/buyer-intents", headers=auth, json={
                "gpu_model": "RTX 4090", "max_total_krw": args.budget,
                "delivery_deadline": deadline.isoformat().replace("+00:00", "Z"),
                "must_have": ["evidence_present"],
            }).json()
            started = client.post("/api/negotiations", headers={**auth, "Idempotency-Key": "smoke"},
                                  json={"buyer_intent_id": intent["id"]}).json()
            negotiation = client.get(f"/api/negotiations/{started['id']}", headers=auth).json()
            audit = client.get(f"/api/flows/{started['flow_id']}/audit", headers=auth).json()
    print("status:", negotiation["status"])
    for item in negotiation.get("assessments", []):
        print(f"- {item['listing_id']}: {item['summary']}")
        for finding in item["findings"]:
            print(f"    {finding['evidence_id']}: {finding['verdict']} · {finding['note']}")
    for offer in negotiation.get("offers", []):
        print(f"offer {offer['listing_id']} round {offer['round']} total {offer['total_krw']:,} · {offer['rationale']}")
    print("blocked:", [item["reason_code"] for item in negotiation.get("blocked_events", [])])
    for usage in audit["model_usage"]:
        print(f"  {usage['actor']}/{usage['step']} {usage.get('outcome')} {usage['input_tokens']}/{usage['output_tokens']} "
              f"${usage.get('cost_usd')} {usage.get('latency_ms')}ms {usage['request_id']}")
    print("totals:", json.dumps(audit["totals"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
