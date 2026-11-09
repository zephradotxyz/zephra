# Contracts

Solidity 0.8.26 (viaIR, EVM cancun), built with Hardhat.

| Contract | Role |
| --- | --- |
| `v4/ZephraV4Launchpad` | Uniswap v4 hook and token factory. Holds the permanent liquidity position, takes fees and the anti-sniper tax |
| `v4/ZephraRouter` | Buy and sell entry point |
| `v4/ZephraQuoter` | Read-only quotes |
| `v4/ZephraTokenV4` | Plain ERC-20 implementation, cloned per token (EIP-1167) |
| `v4/ZephraPoolView` | Read helpers for pool state |
| `PerpMarket` | Isolated perpetual market and vault per graduated token |
| `ZephraConfig` | Guardian (instant pause) and admin (48h timelock, hard bounds). No function can withdraw user funds |

```bash
npm install --legacy-peer-deps
npx hardhat test          # 42 tests
```

Deploying (mainnet): copy `.env.example` to `.env`, fill in your own RPC, roles and `DEPLOYER_PK`, then run `scripts/deploy-v4.js` with `CONFIRM_MAINNET=yes`. Use a multisig for `ADMIN` and `TREASURY`.

`deployments/elysiumMainnetV4.json` lists the live addresses. `verification/v4/` holds the standard-JSON inputs that reproduce the deployed bytecode.
