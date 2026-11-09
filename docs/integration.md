# Zephra: technical notes for GMGN, fomo and DexScreener

Zephra is a token launchpad on **Elysium mainnet (chain id 99901)**. Every token trades in a **standard Uniswap v4 pool**
against native **HYPE** (18 decimals) from its first block. There is no separate bonding-curve contract and no pool
migration, so a standard Uniswap v4 parser sees every trade.

Tokens are plain ERC-20 (18 decimals, fixed supply of 1,000,000,000, no mint, no owner, no blacklist, no pause).

## 1. Contracts (Elysium mainnet)

| Contract | Address |
| --- | --- |
| Uniswap v4 PoolManager | `0xe2e105d3f7209a9da11f83ccf3e7398a753823f1` |
| ZephraV4Launchpad (the pool hook and the token factory) | `0x009557496762b804b28C3D051318Aee2b8a8AACC` |
| ZephraRouter (buy and sell entry point) | `0x4c104E998E5024aBB2a098D4dE1fcf01cc8D43d4` |
| ZephraQuoter (read-only quotes) | `0xAfc50B0208576D486C5AfA767C182AD0617B939f` |
| ZephraConfig | `0x21DC69A011404BF667988169e528DDf22e563796` |
| MarketFactory (perp market per graduated token) | `0x16c898FCAb0935DAf101f6d34aF4F90971155aaA` |
| PoolViewFactory | `0x92bE66d06a3D8c7Be5f01E00150A0A41D46A509A` |
| Token implementation (ERC-1167 clones) | `0x3976B4427F3e5064f0222f60c84A1dA0F535D6B2` |

Admin `0x11341c88Bbf32fF62741324d7B533CB65dBf2159`, guardian `0x00ff4A225bc94724Da0286dF8D5fc8B00FFb35De`,
treasury `0xb51AB221225470514985D931Fa948D7E1a43071E`. Deployment block: **3036337**.
Addresses are also in `contracts/deployments/elysiumMainnetV4.json`.

## 2. Custom hook: yes

The pool uses a **custom Uniswap v4 hook** (the launchpad contract itself). The pool is still a normal v4 pool: it is created
in the official PoolManager, swaps emit the standard `Swap` event, and the pool key is `(HYPE native, token, fee, tickSpacing, hook)`.
The hook does the following:
- Takes the trading fee (1% before graduation, 2% after) and the creator tax, and splits them.
- Applies the anti-sniper tax during the first 60 seconds.
- Holds the single liquidity position permanently. There is no function to remove or move it.
- Emits a `Trade` event on every swap for convenience.

## 3. Pool parameters

- Pair: native HYPE (currency0 = address(0)) and the token.
- One position per token: start tick `169800`, lower tick `120200`. Seeded at launch with the full supply.
- Graduation at 97 HYPE raised (about $30K market cap). Graduation does not move liquidity; it opens the perp market.
- Liquidity is permanent and held by the hook. It is not an LP-token position that anyone can burn or withdraw.

## 4. Events

Standard Uniswap v4 `Swap` and `Initialize` events come from the PoolManager. The hook adds:

```
TokenCreated(address indexed token, address indexed creator, string name, string symbol,
             uint256 devTokens, uint32 taxWindow, uint16 startTaxBps, uint8 perpMaxLeverage, string metadata)
Trade(address indexed token, address indexed trader, bool isBuy, uint256 hypeAmount,
      uint256 tokenAmount, uint256 fee, uint256 netQuote, uint256 tokensSold)
TokenImage(address indexed token, string image)
Graduated(address indexed token, address pool, address market, uint256 poolHYPE, uint256 poolTokens)
FeeSplitsSet(address indexed token, address[] to, uint16[] bps)
```

Start all log scans at block 3036337. `eth_getLogs` on the public RPC is limited to about 2000 blocks per call.

## 5. Token metadata

Each token exposes `contractURI()` (IPFS JSON with name, symbol, description, image, links),
so an indexer can read the logo straight from the token. The logo is also stored in the pool through the `TokenImage` event.

## 6. Trust profile

- No owner, no mint, no pause, no blacklist, no transfer tax on the token.
- The dev buy is locked and vests over time inside the hook.
- Liquidity cannot be removed by anyone, including Zephra.
- Fees and the creator tax (capped at 10%) are taken by the hook on swap, not by the token.

## 7. Links

- GMGN: `https://gmgn.ai/elysium/token/<token>` (chain slug not confirmed by GMGN)
- fomo: `https://fomo.family/tokens/elysium/<lowercase token>`

## 8. Status

- Source verification on the Elysium explorer: a ready package is in `contracts/verification/v4`
  (one standard-input file per contract, plus constructor arguments in `README.txt`). The explorer has no public
  verification API, so upload is done by hand in its UI.
- "LP burned" style flags: liquidity sits in the hook, not in burnable LP tokens. A tool that only recognises burned
  LP tokens will not mark it as burned even though it can never be withdrawn. Ask the indexer to treat
  "hook-owned, no removal function" as locked.
- Indexing of each new token by GMGN is under their control and is not confirmed.
