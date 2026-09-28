"""Read-only verification of an existing original transaction against a saved snapshot."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import Settings
from app.chain import EvmChain
from app.policy import digest

parser = argparse.ArgumentParser()
parser.add_argument("--record-id", required=True)
parser.add_argument("--tx-hash", required=True)
parser.add_argument("--snapshot", type=Path, required=True, help="Snapshot JSON exported from the evidence API")
args = parser.parse_args()
cfg = Settings.env()
cfg.validate()
if cfg.chain_mode != "evm": raise SystemExit("CHAIN_MODE must be evm")
snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
try:
    result = EvmChain(cfg).reconcile(args.record_id, digest(snapshot), {"tx_hash": args.tx_hash, "chain_id": cfg.chain_id, "contract": cfg.chain_contract})
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["status"] == "CONFIRMED" else 1)
except Exception:
    print('{"status":"UNKNOWN","details":"redacted"}')
    raise SystemExit(1)
