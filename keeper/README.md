# Keeper

A small Node service that keeps perp markets healthy and exposes a read-only API.

- Market heartbeat, liquidations, profit cap, LP withdrawals, market status, `markFailed`
- IPFS metadata pinning for launches (Pinata or local storage)
- Read API: `GET /health`, `GET /tokens`, `GET /tokens/:address`, `POST /ipfs/launch`, `GET /ipfs/:cid`
- `POST /rpc`: read-only JSON-RPC proxy for the website (allow-listed methods, rate limited)

```bash
cp .env.example .env     # set KEEPER_PK to a dedicated hot wallet
npm install
npm start
```

The keeper wallet only pays gas and calls permissionless functions. Never reuse the deployer or admin key. Secrets come from environment variables only.
