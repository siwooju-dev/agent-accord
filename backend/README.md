# Agent Accord backend

FastAPI implementation of the v0.1 contract in [`../api-spec.md`](../api-spec.md). The local store is SQLite; the app uses the existing `blockchain/` signing and relayer adapter.

## Local mock

From the repository root, create a Python 3.12 environment and install the pinned backend, API, and local EVM test dependencies:

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
```

Run the backend with a local database:

```sh
APP_MODE=mock CHAIN_MODE=mock ALLOW_DEMO_SESSIONS=true \
DATABASE_PATH=data/demo.sqlite3 \
.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

The frontend's Vite server proxies `/api` to `http://localhost:8000`. Open `/?mode=live` to use this API. `APP_MODE=mock` uses deterministic local agents. `CHAIN_MODE=mock` validates both EIP-712 signatures but never submits a transaction; the final status is `MOCK_RECORDED`, with no transaction hash.

Interactive API docs are at `http://localhost:8000/docs`; the OpenAPI JSON is at `http://localhost:8000/openapi.json`.

## Live providers

`APP_MODE=live` uses Kiln and requires `CHAIN_MODE=live`. Set `KILN_API_KEY`, chain RPC/address, and `RELAYER_PRIVATE_KEY` in the backend process environment. Do not put secrets in Vite variables or browser code. Demo-session login is disabled by default in live mode; `ALLOW_DEMO_SESSIONS=true` is only for a controlled demo environment and is not production authentication.

## Verification

```sh
cd contracts && npm ci && npm run compile
cd ..
.venv/bin/python -m pytest -q backend/tests blockchain/tests/test_signing.py blockchain/tests/test_local_evm.py
```

Mock mode and local EVM tests do not demonstrate Kiln availability or a Base Sepolia transaction. A real `RECORDED` status requires a successful testnet receipt, matching event, and matching contract storage record.
