# Agent Accord frontend

React + TypeScript + Vite frontend for the GPU negotiation demo. The default page is the clearly labelled `demo/mock` prototype. `?mode=live` uses the `/api` contract from `project.md`, `frontend.md`, and `api-spec.md` on `main`. Live mode never substitutes mock results for API errors.

## Run

```powershell
npm ci
npm run dev
```

The live page is `http://localhost:5173/?mode=live`. Vite proxies local `/api` requests to `http://localhost:8000`. Requests forwarded through a public tunnel are blocked from the demo API. Start the FastAPI app from the repository root with `python -m uvicorn backend.main:app --reload --port 8000` after the backend team provides it. The current API document describes a planned contract, so live requests show a connection error until that service exists.

The demo session token stays in browser memory. Configure demo actor wallets and Base Sepolia contract data on the backend; the selected actor's `wallet_address`, agreement `expected_wallet`, and connected browser wallet must agree. The frontend requests EIP-712 signatures from the browser wallet and never handles private keys. Only a server verified testnet receipt, event, and recorded hash are presented as a confirmed chain record.

## Check

```powershell
npm run lint
npm run test
npm run build
```
