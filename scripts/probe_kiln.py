"""No guessed URL, no secrets/response text printed, no retry/billable call by default."""
import argparse
import json
import os
import sys
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import Settings
from app.agent import KilnAgent, ModelFailure


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--call-once", action="store_true", help="Explicit opt-in to exactly ONE billable negotiation request")
    args = parser.parse_args()
    settings = Settings.env()
    missing = [k for k in ("KILN_BASE_URL", "KILN_API_KEY", "KILN_MODEL") if not os.getenv(k)]
    if missing:
        print(json.dumps({"status": "NOT_RUN", "missing_environment_names": missing}))
        return 2
    if not settings.kiln_base_url.startswith("https://") or settings.kiln_auth not in {"bearer", "x-api-key"}:
        print('{"status":"INVALID_CONFIGURATION"}')
        return 2
    adapter = KilnAgent(settings)
    try:
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            response = client.get(settings.kiln_base_url.rstrip("/") + "/models", headers=adapter.headers())
        if response.status_code != 200:
            print(json.dumps({"status": "MODELS_FAILED", "http_status": response.status_code}))
            return 1
        ids = [x["id"] for x in response.json()["data"]]
        print(json.dumps({"status": "MODELS_CHECKED", "model_ids": ids, "selected_available": settings.kiln_model in ids}))
        if settings.kiln_model not in ids: return 1
        if args.call_once:
            product = {"product_id": "probe-simulated", "seller_id": "probe-seller", "ram_gb": 16, "ssd_gb": 512,
                       "asking_price_krw": 970000, "shipping_fee_krw": 10000, "fee_krw": 5000, "delivery_date": "2099-01-01"}
            proposal, usage = adapter.propose("buyer", product, {"max_total_krw": 1000000}, None)
            print(json.dumps({"status": "ONE_CALL_VALIDATED", "action": proposal.action, "usage": usage}, ensure_ascii=False))
        return 0
    except ModelFailure as exc:
        print(json.dumps({"status": "ONE_CALL_BLOCKED", "reason_code": exc.code, "usage": exc.usage}))
        return 1
    except Exception:
        print('{"status":"PROBE_FAILED","details":"redacted"}')
        return 1


if __name__ == "__main__": raise SystemExit(main())
