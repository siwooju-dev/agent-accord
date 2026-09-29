"""Run demo flows end to end against a live backend, signing with local test wallets.

    .venv/bin/python scripts/run_flows.py B C

Starts a second live backend (Kiln + Base Sepolia) on port 8011 with its own database
(data/live-script.sqlite3) whose buyer and sellers are local test wallets kept in
.local/test_wallets.json (git-ignored, testnet only, no funds). Each flow goes through the
same HTTP API as the web UI: buyer intent -> Kiln negotiation -> EIP-712 approvals by both
parties -> relayer records on the AgreementRegistry. Nothing here touches MetaMask; flows
signed in the browser live in data/live.sqlite3 instead.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import load_local_env  # noqa: E402

FLOWS = {
    "A": {"label": "기본 조건", "max_total_krw": 2_400_000, "days": 10},
    "B": {"label": "예산 감소", "max_total_krw": 2_000_000, "days": 10},
    "C": {"label": "기한 단축", "max_total_krw": 2_400_000, "days": 3},
}
ACTORS = ("buyer-demo", "seller-demo-1", "seller-demo-2", "seller-demo-3")
WALLETS = ROOT / ".local" / "test_wallets.json"
PORT = int(os.getenv("SCRIPT_PORT", "8011"))
BASE = f"http://127.0.0.1:{PORT}"


def wallets() -> dict[str, str]:
    from eth_account import Account

    if WALLETS.exists():
        return json.loads(WALLETS.read_text(encoding="utf-8"))
    keys = {actor: "0x" + Account.create().key.hex().removeprefix("0x") for actor in ACTORS}
    WALLETS.parent.mkdir(parents=True, exist_ok=True)
    WALLETS.write_text(json.dumps(keys), encoding="utf-8")
    os.chmod(WALLETS, stat.S_IRUSR | stat.S_IWUSR)
    return keys


def start_backend(keys: dict[str, str]) -> subprocess.Popen:
    from eth_account import Account

    actors = {actor: {"role": "buyer" if actor == "buyer-demo" else "seller",
                      "wallet_address": Account.from_key(key).address} for actor, key in keys.items()}
    env = {**os.environ, "APP_MODE": "live", "CHAIN_MODE": "live", "ALLOW_DEMO_SESSIONS": "true",
           "DATABASE_PATH": str(ROOT / "data" / "live-script.sqlite3"), "DEMO_ACTORS_JSON": json.dumps(actors)}
    log = open(ROOT / ".local" / "backend-script.log", "a", encoding="utf-8")
    process = subprocess.Popen(
        [str(ROOT / ".venv" / "bin" / "python"), "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
         "--port", str(PORT)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    import httpx

    for _ in range(40):
        try:
            health = httpx.get(f"{BASE}/health", timeout=2).json()
            if health["mode"] == "live" and health["chain_mode"] == "live":
                return process
        except Exception:
            time.sleep(0.5)
    process.terminate()
    raise SystemExit("backend did not start; see .local/backend-script.log")


def sign(typed_data: dict, key: str) -> str:
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from web3 import Web3

    return Web3.to_hex(Account.sign_message(encode_typed_data(full_message=typed_data), key).signature)


def run_flow(client, keys: dict[str, str], name: str) -> dict:
    spec = FLOWS[name]
    login = lambda actor: {"Authorization": "Bearer " + client.post(  # noqa: E731
        f"{BASE}/api/demo/sessions", json={"actor_id": actor}).json()["access_token"]}
    buyer = login("buyer-demo")
    deadline = (datetime.now(timezone.utc) + timedelta(days=spec["days"])).replace(microsecond=0)
    for attempt in range(2):
        intent = client.post(f"{BASE}/api/buyer-intents", headers=buyer, json={
            "gpu_model": "RTX 4090", "max_total_krw": spec["max_total_krw"],
            "delivery_deadline": deadline.isoformat().replace("+00:00", "Z"), "must_have": ["evidence_present"],
        }).json()
        started = client.post(f"{BASE}/api/negotiations", json={"buyer_intent_id": intent["id"]},
                              headers={**buyer, "Idempotency-Key": f"script-{name}-{intent['id']}"}).json()
        print(f"[{name}] {spec['label']} · flow {started['flow_id']} · negotiating…", flush=True)
        for _ in range(90):
            negotiation = client.get(f"{BASE}/api/negotiations/{started['id']}", headers=buyer).json()
            if negotiation["status"] != "NEGOTIATING":
                break
            time.sleep(2)
        blocked = [item["reason_code"] for item in negotiation.get("blocked_events", [])]
        print(f"[{name}]   {negotiation['status']} · offers "
              f"{[(o['listing_id'], o['total_krw'], o['round']) for o in negotiation['offers']]} · blocked {blocked}", flush=True)
        if negotiation.get("agreement_id"):
            break
        if attempt == 0:
            print(f"[{name}]   no agreement; retrying once", flush=True)
    else:
        return {"flow": name, "flow_id": started["flow_id"], "status": negotiation["status"]}

    agreement_id = negotiation["agreement_id"]
    seller_id = client.get(f"{BASE}/api/agreements/{agreement_id}", headers=buyer).json()["snapshot"]["seller_id"]
    for actor, headers in (("buyer-demo", buyer), (seller_id, login(seller_id))):
        payload = client.get(f"{BASE}/api/agreements/{agreement_id}/approval-payload", headers=headers).json()
        decision = client.post(f"{BASE}/api/agreements/{agreement_id}/decisions", headers=headers, json={
            "decision": "approve", "snapshot_hash": payload["snapshot_hash"],
            "signature": sign(payload["typed_data"], keys[actor]),
        })
        print(f"[{name}]   {actor} signed → {decision.status_code} {decision.json().get('status')}", flush=True)
    for _ in range(60):
        agreement = client.get(f"{BASE}/api/agreements/{agreement_id}", headers=buyer).json()
        if agreement["status"] in {"RECORDED", "CHAIN_FAILED", "MOCK_RECORDED"}:
            break
        time.sleep(3)
    chain = agreement["chain"]
    print(f"[{name}]   {agreement['status']} · tx {chain.get('tx_hash')} · block {chain.get('block_number')}", flush=True)
    return {"flow": name, "label": spec["label"], "flow_id": negotiation["flow_id"], "agreement_id": agreement_id,
            "seller_id": seller_id, "status": agreement["status"], "tx_hash": chain.get("tx_hash")}


def main() -> int:
    names = [name.upper() for name in sys.argv[1:]] or ["B", "C"]
    if any(name not in FLOWS for name in names):
        print(f"flows: {', '.join(FLOWS)}", file=sys.stderr)
        return 1
    load_local_env()
    import httpx

    keys = wallets()
    process = start_backend(keys)
    try:
        with httpx.Client(timeout=60) as client:
            results = [run_flow(client, keys, name) for name in names]
    finally:
        process.terminate()
        process.wait(timeout=10)
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if all(result.get("status") == "RECORDED" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
