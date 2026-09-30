# Agent Accord frontend

React + TypeScript + Vite frontend. `/` is the API-backed application; `?mode=mock` opens the offline visual prototype. The live page shows backend, agent, and chain configuration from the API health response rather than a hard-coded status.

## Run locally

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5180
```

Run the API separately from the repository root. The Vite proxy sends `/api` to `http://localhost:8000`; set `ACCORD_API_TARGET` if the API uses another local port. Wallet login requires an EIP-1193 browser wallet and Base Sepolia. Login signs a short-lived message; approvals use EIP-712 and the application never reads wallet private keys.

## Public tunnel

For a temporary ngrok preview, use the production build, keep the backend bound to loopback, set `ACCORD_API_TARGET` to that backend, and explicitly set `ACCORD_PUBLIC_TUNNEL_API=true` on the Vite preview process. The local API proxy then accepts only same-origin HTTPS requests whose forwarded host is an ngrok domain. Do not expose the backend port or put secrets in Vite variables. See [`../docs/WEB_QA.md`](../docs/WEB_QA.md).

## Check

```sh
npm run lint
npm test
npm run build
```
