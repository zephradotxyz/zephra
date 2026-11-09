#!/bin/bash
# Resumable mainnet deploy through the local failover RPC proxy. Safe to re-run.
cd "$(dirname "$0")/.."
node scripts/rpc-proxy.js > /tmp/proxy.log 2>&1 &
PROXY=$!
trap "kill $PROXY 2>/dev/null" EXIT
sleep 2
export DEPLOY_START_NONCE=${DEPLOY_START_NONCE:-0} DEPLOYER_PK="$MAINNET_DEPLOYER_PK" ADMIN="$MAINNET_ADMIN" GUARDIAN="$MAINNET_GUARDIAN" TREASURY="$MAINNET_TREASURY" GRAD_TARGET="$MAINNET_GRAD_TARGET" CREATION_FEE="$MAINNET_CREATION_FEE" ELYSIUM_MAINNET_RPC=http://127.0.0.1:8599 ELYSIUM_MAINNET_CHAIN_ID=99901 EXPLORER_URL=https://elyscan.live PUBLIC_API_URL=/keeper CONFIRM_MAINNET=yes HARDHAT_DISABLE_TELEMETRY_PROMPT=true
for i in $(seq 1 300); do
  timeout 280 pnpm exec hardhat run scripts/deploy.js --network elysiumMainnet > /tmp/deploy.$i.log 2>&1 && { echo DONE $i; cat /tmp/deploy.$i.log; exit 0; }
  echo "attempt $i failed"; sleep 5
done
echo GAVEUP
