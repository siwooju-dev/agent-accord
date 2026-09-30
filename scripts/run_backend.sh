#!/usr/bin/env bash
# Start the API. `live` = Kiln agents + Base Sepolia recording; `mock` = local agents, no chain.
#   scripts/run_backend.sh live     (needs .env.local from scripts/setup_secrets.py and a deployed contract)
#   scripts/run_backend.sh mock
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mode="${1:-mock}"
if [[ "$mode" == "live" ]]; then
  export APP_MODE=live CHAIN_MODE=live ALLOW_DEMO_SESSIONS=false
  export DATABASE_PATH="${DATABASE_PATH:-data/live.sqlite3}"
else
  export APP_MODE=mock CHAIN_MODE=mock ALLOW_DEMO_SESSIONS=true
  export DATABASE_PATH="${DATABASE_PATH:-data/demo.sqlite3}"
fi
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "${PORT:-8000}"
