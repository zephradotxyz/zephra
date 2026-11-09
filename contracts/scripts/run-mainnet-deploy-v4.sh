#!/bin/bash
# Resumable v4 mainnet deploy through the failover RPC proxy. Safe to re-run with the same DEPLOY_START_NONCE.
cd "$(dirname "$0")/.."
node scripts/rpc-proxy.js > proxy.log 2>&1 &
PROXY=$!
trap "kill $PROXY 2>/dev/null" EXIT
sleep 2
export DEPLOYER_PK="$MAINNET_DEPLOYER_PK" ELYSIUM_MAINNET_RPC=http://127.0.0.1:8599 ELYSIUM_MAINNET_CHAIN_ID=99901 CONFIRM_MAINNET=yes HARDHAT_DISABLE_TELEMETRY_PROMPT=true
for i in $(seq 1 300); do
  timeout 280 pnpm exec hardhat run scripts/deploy-v4.js --network elysiumMainnet > deploy-v4.$i.log 2>&1 && { echo DONE $i; cat deploy-v4.$i.log; exit 0; }
  echo "attempt $i failed"; tail -3 deploy-v4.$i.log; sleep 5
done
echo GAVEUP
