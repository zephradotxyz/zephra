<p align="center"><img src="docs/logo.png" width="96" alt="Zephra"></p>

<h1 align="center">Zephra</h1>

<p align="center">A token launchpad on Elysium. Every token trades from its first block in a standard Uniswap v4 pool against HYPE. Tokens that reach the graduation target unlock their own perpetual market.</p>

<p align="center"><a href="https://zephra.xyz">zephra.xyz</a> · <a href="https://x.com/Zephra_xyz">X</a> · <a href="docs/integration.md">Integration notes</a> · <a href="SECURITY.md">Security</a></p>

---

## What it does

- **Launch** a token in one transaction. Fixed supply of 1,000,000,000, no owner, no mint, no pause, no blacklist.
- **Trade** in a standard Uniswap v4 pool (native HYPE / token). Any v4-aware indexer can read every swap.
- **Permanent liquidity.** The whole supply is one liquidity position held by the launchpad hook. There is no function to remove or move it.
- **Creator tools.** Optional creator tax (up to 10%), fee split across up to 5 wallets, anti-sniper tax that decays from a chosen start value to the normal fee.
- **Graduation.** At 97 HYPE raised the pool fee rises from 1% to 2% and the token's isolated perp market (up to 3x leverage, backed by its own vault) opens.

## Repository layout

| Folder | Contents |
| --- | --- |
| [`contracts/`](contracts) | Solidity 0.8.26 contracts (Hardhat), 42 tests, deploy scripts, verification inputs |
| [`app/`](app) | React + Vite + Tailwind web app. Reads everything from the chain and sends transactions from the user's own wallet |
| [`keeper/`](keeper) | Node service: market heartbeat, liquidations, IPFS metadata pinning, read-only token API |
| [`docs/`](docs) | Technical integration notes for indexers and aggregators |

## Deployed contracts (Elysium mainnet, chain id 99901)

| Contract | Address |
| --- | --- |
| Uniswap v4 PoolManager | `0xe2e105d3f7209a9da11f83ccf3e7398a753823f1` |
| ZephraV4Launchpad (hook and token factory) | `0x009557496762b804b28C3D051318Aee2b8a8AACC` |
| ZephraRouter | `0x4c104E998E5024aBB2a098D4dE1fcf01cc8D43d4` |
| ZephraQuoter | `0xAfc50B0208576D486C5AfA767C182AD0617B939f` |
| ZephraConfig | `0x21DC69A011404BF667988169e528DDf22e563796` |
| MarketFactory | `0x16c898FCAb0935DAf101f6d34aF4F90971155aaA` |

The compiled sources in this repository reproduce the deployed bytecode. See [`contracts/verification/v4/README.txt`](contracts/verification/v4/README.txt).

## Fees

| | |
| --- | --- |
| Launch fee | 0.05 HYPE |
| Trading fee | 1% before graduation, 2% after |
| Creator tax | 0 to 10%, chosen at launch. Zephra keeps 0.5% of trade value |
| Anti-sniper tax | Start 10 to 100%, window 30 to 300 seconds, decays to the normal fee |

## Quick start

```bash
# contracts: compile and test
cd contracts && npm install --legacy-peer-deps && npx hardhat test

# app
cd app && cp .env.example .env && npm install && npm run dev

# keeper
cd keeper && cp .env.example .env   # add your own KEEPER_PK
npm install && npm start
```

## Security

Smart contracts are **unaudited**. Use at your own risk. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). No private key, token or credential is stored in this repository; all secrets are read from environment variables.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
