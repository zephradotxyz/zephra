// Zephra documentation. Every number here matches the deployed contracts
// (ZephraLaunchpad, ZephraPool, PerpMarket, ZephraConfig).
import { H2, H3, P, B, Code, UL, Steps, Table, Formula, Callout, DocLink, ExtLink, type DocPage } from "../../components/DocKit";
import { useEngine } from "../../store";
import { getDeployment, getNetwork, addrUrl } from "../../chain/config";
import { fmt } from "../../lib/format";


function GValue() {
  const e = useEngine();
  return <>{e.G > 0 ? `${fmt(e.G, e.G < 100 ? 2 : 0)} HYPE on this deployment` : "set at deploy"}</>;
}

export const DOCS: DocPage[] = [
  // ───────────────────────────── Getting started
  {
    slug: "introduction",
    group: "Getting started",
    title: "Introduction",
    summary: "Zephra is a token launchpad on Elysium. Every token trades from its first second in a standard Uniswap v4 pool, and when it reaches its graduation target it automatically gets its own isolated perpetual market, backed by a dedicated vault.",
    Body: () => (
      <>
        <H2>What Zephra does</H2>
        <P>
          Most launchpads stop at the spot listing. On Zephra a token is launched straight into a <B>Uniswap v4 pool</B> with{" "}
          <B>permanently locked liquidity</B>, so wallets, DEX screeners and aggregators such as GMGN, fomo and DexScreener can index it like any
          other v4 token. When the pool has taken in the graduation target, the protocol opens an <B>isolated perp market</B> for that token. The perp
          market has its own <B>Perp Vault</B> that acts as the counterparty to every trader, so the token can be traded long or short without an
          order book or outside market makers.
        </P>
        <H2>The lifecycle in one view</H2>
        <Table
          head={["Stage", "What happens", "Who benefits"]}
          rows={[
            ["Launch", "Creator deploys the token with optional anti-sniper tax and a perp leverage cap.", "Creator sets the rules once; they are enforced on-chain."],
            ["Pool trading", "The whole supply sits in one Uniswap v4 pool from block one. Anyone buys or sells with HYPE.", "Early buyers, the creator (fee share) and the future vault (escrow)."],
            ["Graduation", "When the pool has taken in the target G (about $30K market cap), the perp market and vault open. The pool stays exactly as it is.", "Traders and vault LPs get a perp market."],
            ["Spot + perps", "Spot trading on the pool (2% fee), long/short up to 3x on the perp market.", "Traders, vault LPs (fees + funding), the creator."],
          ]}
        />
        <H2>Why Elysium</H2>
        <P>
          Elysium is an Arbitrum Orbit L2 that settles to HyperEVM and uses HYPE for gas. Blocks arrive every 100–200 ms, which
          keeps swaps and perp entries fast, and fees are low enough for keepers to send a heartbeat every few seconds.
        </P>
        <H2>Where to go next</H2>
        <UL
          items={[
            <><DocLink to="/docs/quickstart">Quickstart</DocLink>: connect a wallet and make your first trade.</>,
            <><DocLink to="/docs/launch-guide">Launching a token</DocLink>: every launch setting explained.</>,
            <><DocLink to="/docs/bonding-curve">Mechanics</DocLink>: how the pool, graduation and the perps work.</>,
            <><DocLink to="/docs/fees">Fees</DocLink>: who pays what, and where it goes.</>,
          ]}
        />
      </>
    ),
  },
  {
    slug: "quickstart",
    group: "Getting started",
    title: "Quickstart",
    summary: "From zero to your first trade on Elysium in a few minutes.",
    Body: () => (
      <>
        <Steps
          items={[
            {
              title: "Connect a wallet",
              body: <>Click <B>Connect</B> in the top right. MetaMask, Rabby or any injected wallet works; Zephra adds Elysium for you.</>,
            },
            {
              title: "Bring HYPE to Elysium",
              body: <>Bridge HYPE from HyperEVM using the official Elysium bridge linked from Kinetiq's channels. HYPE pays for gas and is the quote asset for every market.</>,
            },
            {
              title: "Buy a token",
              body: <>Open any token from <DocLink to="/">Launches</DocLink>, enter an amount of HYPE and confirm. The price moves with every trade. You can sell back into the pool at any time.</>,
            },
            {
              title: "Trade perps after graduation",
              body: <>Graduated tokens show a <B>Perp</B> tab. Choose long or short, set margin and leverage (up to the token's cap), and review the pessimistic entry price, liquidation price and max profit before confirming.</>,
            },
            {
              title: "Earn as a vault LP",
              body: <>On <DocLink to="/earn">Earn</DocLink>, deposit HYPE into a token's Perp Vault. You earn trading fees, a share of spot fees, funding and trader losses, and you take the other side of trader profits.</>,
            },
          ]}
        />
        <Callout tone="tip" title="Track everything">
          Every action shows a pending notification with a <B>View tx</B> link. Your full transaction history is in the wallet menu.
        </Callout>
      </>
    ),
  },
  {
    slug: "launch-guide",
    group: "Getting started",
    title: "Launching a token",
    summary: "Each launch setting is stored on-chain at creation and cannot be changed afterwards.",
    Body: () => (
      <>
        <H2>Basics</H2>
        <UL
          items={[
            <><B>Name and ticker</B>: stored in the ERC-20 contract. Total supply is always 1,000,000,000 tokens with 18 decimals.</>,
            <><B>Logo</B>: PNG, JPG, WebP or SVG. It is resized in your browser to a square WebP and pinned to <B>IPFS</B> together with the metadata; only the content-addressed <code>ipfs://</code> link is stored on-chain, so it can never be swapped.</>,
            <><B>Description and links</B>: website, X and Telegram, stored in the same IPFS metadata file (links must be https).</>,
            <><B>Creation fee</B>: a flat fee in HYPE paid to the protocol treasury.</>,
          ]}
        />
        <H2>Dev buy</H2>
        <P>
          The creator can buy up to <B>10% of supply</B> in the creation transaction. Those tokens are <B>locked</B> and vest linearly
          over <B>3 days</B>, so a creator cannot dump on the first buyers. Vested tokens are claimed from the creator panel on the token page.
        </P>
        <H2>Anti-sniper tax</H2>
        <P>
          An optional tax on buys in the first seconds after launch. It replaces the normal 1% buy fee while active and decays linearly to 2%.
        </P>
        <Table
          head={["Setting", "Range", "Default"]}
          rows={[
            ["Start tax", "10% – 100%", "100%"],
            ["Window", "Off, or 30 – 300 seconds", "60 seconds"],
            ["End tax", "Always 2% at the end of the window", "—"],
          ]}
        />
        <P>
          See <DocLink to="/docs/anti-sniper-tax">Anti-sniper tax</DocLink> for the formula and how the proceeds are split.
        </P>
        <H2>Perp leverage cap</H2>
        <P>
          Choose <B>1x, 2x or 3x</B> as the maximum leverage for your token's perp market. During the first 24 hours after graduation the
          market allows at most 2x regardless of the cap. A 1x cap makes the perp a spot-like hedging instrument.
        </P>
        <H2>What you earn as the creator</H2>
        <UL
          items={[
            "25% of the 1% trading fee before graduation (37.5% of the 2% fee after it), plus 25% of the anti-sniper tax (that part unlocks at graduation).",
            "Your own creator tax, if you set one (up to 10% of every trade). Zephra keeps 0.5% of trade value out of it.",
            "All of it is claimable from the token page, and you can split it between up to 5 wallets.",
          ]}
        />
      </>
    ),
  },

  // ───────────────────────────── Mechanics
  {
    slug: "bonding-curve",
    group: "Mechanics",
    title: "Pool and pricing",
    summary: "Every token trades in one Uniswap v4 pool with a single permanent liquidity position, from the first buy to graduation and beyond.",
    Body: () => (
      <>
        <H2>How the pool is built</H2>
        <P>
          At launch the hook contract mints the full supply of 1,000,000,000 tokens and places all of it in a Uniswap v4 pool as <B>one position</B>.
          The pool pairs native HYPE with the token, has a 0 LP fee (Zephra charges its own fee in the hook), and the position can never be changed
          or withdrawn.
        </P>
        <Formula>{`pair          = HYPE / token (native HYPE, no wrapping)
start price   = tick 169,800 (about 42 HYPE opening market cap)
price floor   = tick 120,200 (the position's lower edge)
liquidity     = one constant position, so price follows x · y = k inside that range`}</Formula>
        <P>
          Buying adds HYPE and removes tokens, so the price rises; selling does the reverse. The pool accepts exact-input swaps only, and nobody
          (including Zephra) can add or remove liquidity.
        </P>
        <H2>Fees</H2>
        <Table
          head={["Trade", "Fee", "Split"]}
          rows={[
            ["Before graduation", "1% (or the anti-sniper tax while active)", "50% Zephra · 25% creator · 25% vault escrow"],
            ["After graduation", "2%", "37.5% creator · 37.5% perp vault · 25% Zephra"],
            ["Creator tax (optional)", "0 – 10% on top", "To the creator, minus 0.5% of the trade value that Zephra keeps"],
          ]}
        />
        <P>
          The <B>vault escrow</B> accumulates in the hook during the pool phase and becomes the starting liquidity of the token's Perp Vault at
          graduation. The creator's dev buy pays no fee.
        </P>
        <H2>Slippage protection</H2>
        <P>
          Every buy and sell takes a minimum output and a deadline. If the price moves past your tolerance before the transaction is included, it
          reverts and only gas is spent.
        </P>
        <H2>Open to every router</H2>
        <P>
          The pool is a normal Uniswap v4 pool, so any v4 router or aggregator can swap in it. The Zephra interface uses its own simple router
          (<Code>ZephraRouter</Code>), and <Code>ZephraQuoter</Code> returns price quotes.
        </P>
      </>
    ),
  },
  {
    slug: "anti-sniper-tax",
    group: "Mechanics",
    title: "Anti-sniper tax",
    summary: "A decaying launch tax that makes block-one sniping unprofitable and pays the creator and the future vault instead.",
    Body: () => (
      <>
        <H2>Formula</H2>
        <Formula>{`t       = seconds since the token was created
window  = tax window chosen by the creator (30–300 s)
start   = start tax chosen by the creator (10–100%)

tax(t)  = max(2%, start − (start − 2%) × t / window)   while t < window
fee     = 1%                                           after the window`}</Formula>
        <P>
          With the defaults (100% over 60 s) a buy at second 30 pays 51%, a buy at second 54 pays about 11.8%, and from second 60 the normal
          1% fee applies. A buy that would pay exactly 100% reverts.
        </P>
        <H2>Where the tax goes</H2>
        <Table
          head={["Share", "Recipient", "Notes"]}
          rows={[
            ["50%", "Protocol treasury", "—"],
            ["25%", "Creator", "Locked until the token graduates"],
            ["25%", "Vault escrow", "Moves into the Perp Vault at graduation"],
          ]}
        />
        <Callout title="Why lock the creator's share?">
          It removes the incentive for a creator to snipe their own launch through other wallets: the tax they would pay is only partly returned,
          and only later.
        </Callout>
        <P>Sells are never taxed; they always pay the normal 1% fee (2% after graduation).</P>
      </>
    ),
  },
  {
    slug: "graduation",
    group: "Mechanics",
    title: "Graduation",
    summary: "When the pool has taken in the target, the token's perp market and vault open. The pool itself does not change.",
    Body: () => (
      <>
        <H2>What happens at graduation</H2>
        <P>
          When the HYPE taken in by the pool reaches the graduation target <Code>G</Code> (<GValue />, about a $30K market cap), the token is marked
          as crossed. The next swap, or a call to <Code>graduate(token)</Code> by anyone (the keeper does it), completes graduation:
        </P>
        <UL
          items={[
            "The token's isolated perp market and Perp Vault are created.",
            "The vault is seeded with the escrow collected from trading fees, so it starts funded.",
            "The creator's locked anti-sniper tax share is unlocked.",
            "Fees switch from 1% to 2%, split between creator, perp vault and Zephra.",
            "The perp market stays in a 30-minute warm-up so the price history can build before positions open.",
          ]}
        />
        <P>The pool keeps its liquidity position untouched: there is no migration, no price jump, and nothing for the creator to pull.</P>
        <H2>No failed launches</H2>
        <P>
          Because the pool is permanent and always open, a token never becomes sell-only and there is no "failed" state. Holders can sell into the
          pool at any time.
        </P>
      </>
    ),
  },
  {
    slug: "spot-pool",
    group: "Mechanics",
    title: "Spot pool",
    summary: "The token/HYPE Uniswap v4 pool: permanent liquidity, a 2% fee after graduation and an on-chain TWAP oracle.",
    Body: () => (
      <>
        <H2>Fee</H2>
        <P>After graduation every swap pays 2%, taken on the HYPE side:</P>
        <Table
          head={["Share of the fee", "Recipient"]}
          rows={[
            ["37.5%", "Creator (claimable from the token page)"],
            ["37.5%", "Perp Vault (income for all vault LPs)"],
            ["25%", "Zephra treasury"],
          ]}
        />
        <H2>Oracle</H2>
        <P>
          The hook records a price observation at most every 10 seconds and keeps a ring of 400 observations (just over an hour). The perp market
          reads time-weighted averages from it:
        </P>
        <Table
          head={["TWAP", "Window", "Used for"]}
          rows={[
            ["Execution", "180 s", "Pessimistic entry and exit prices"],
            ["Mark", "60 s", "Liquidations and PnL"],
            ["Settlement", "1 hour", "Final price when a market closes"],
          ]}
        />
        <H2>72-hour volume</H2>
        <P>The pool tracks rolling 72-hour volume. It is one of the two health checks that can move the perp market to close-only.</P>
      </>
    ),
  },
  {
    slug: "perpetuals",
    group: "Mechanics",
    title: "Perpetual markets",
    summary: "Isolated long/short markets per token, priced from the spot pool and backed by the token's Perp Vault.",
    Body: () => (
      <>
        <H2>Pricing that resists manipulation</H2>
        <P>
          A new token's pool is thin, so the perp never trusts one price. Entries and exits use whichever of spot and the 180-second TWAP is
          <B> worse for you</B>, plus a size-based impact of up to 0.5%:
        </P>
        <Formula>{`long entry  = max(spot, TWAP180) × (1 + impact)
short entry = min(spot, TWAP180) × (1 − impact)
impact      = 0.5% × notional / per-side cap   (max 0.5%)`}</Formula>
        <P>New positions are refused while spot is more than 3% away from the TWAP, which blocks pump-and-open attacks.</P>
        <H2>Leverage and size limits</H2>
        <Table
          head={["Limit", "Value"]}
          rows={[
            ["Leverage", "1x up to the creator's cap (max 3x); at most 2x in the first 24 h after graduation"],
            ["Open interest per side", "min(50% of vault NAV, 25% of the pool's HYPE reserve)"],
            ["Per wallet", "20% of the per-side cap"],
            ["Max profit", "2/3 of position notional. A keeper closes positions that reach it"],
          ]}
        />
        <H2>Fees and funding</H2>
        <UL
          items={[
            <>Open and close: <B>0.5% of notional</B> each (0.3% to the vault, 0.2% to the protocol).</>,
            <>Funding accrues every second from the long/short imbalance, capped at <B>0.1% per hour</B>. The heavier side pays; 50% of funding goes to the vault.</>,
          ]}
        />
        <H2>Liquidation</H2>
        <P>
          A position is liquidatable when its equity (margin + PnL − funding, at the mark price) falls below <B>10% of notional</B>. Anyone can
          liquidate; the liquidator receives up to <B>1% of notional</B> from the remaining margin and the rest goes to the vault.
        </P>
        <Callout tone="warn">
          Leverage magnifies losses. At 3x, a 30% adverse move from your entry wipes out most of your margin. Always check the liquidation price
          shown before you confirm.
        </Callout>
      </>
    ),
  },
  {
    slug: "perp-vault",
    group: "Mechanics",
    title: "Perp Vault",
    summary: "Each graduated token has one vault. LPs deposit HYPE and become the counterparty to every trader in that market.",
    Body: () => (
      <>
        <H2>Where vault returns come from</H2>
        <UL
          items={[
            "0.3% of every perp open and close.",
            "0.75% of spot volume after graduation (37.5% of the 2% fee) plus the escrow collected before it.",
            "50% of funding payments.",
            "Liquidation remainders and trader losses.",
          ]}
        />
        <P>The vault loses value when traders close in profit. The OI caps and the 2/3 profit cap limit how much one market can draw from it.</P>
        <H2>Shares and NAV</H2>
        <Formula>{`NAV          = vault HYPE − unrealised trader PnL
share price  = NAV / total shares`}</Formula>
        <H2>Deposits and withdrawals</H2>
        <UL
          items={[
            "Deposits mint shares at the current share price.",
            <>Withdrawals have a <B>1-hour cooldown</B>: you request, then the withdrawal executes at the NAV at execution time (the keeper does this for you).</>,
            "Liquidity reserved for open interest cannot be withdrawn until positions close.",
          ]}
        />
        <Callout tone="warn">Vault returns are not guaranteed. A run of profitable traders can reduce the share price.</Callout>
      </>
    ),
  },
  {
    slug: "market-lifecycle",
    group: "Mechanics",
    title: "Market lifecycle",
    summary: "Perp markets move through warm-up, active, close-only and closed states based on on-chain health checks.",
    Body: () => (
      <>
        <Table
          head={["State", "Opens", "Closes", "Enters when"]}
          rows={[
            ["Warm-up", "No", "—", "Graduation. Lasts 30 minutes"],
            ["Active", "Yes", "Yes", "Warm-up ends, or a close-only market recovers"],
            ["Close-only", "No", "Yes", "Pool HYPE < 30% of its starting level, or 72 h volume < 1% of G (checked after the first 72 h)"],
            ["Closed", "No", "Settled", "Still unhealthy after 72 h in close-only. All positions settle at the 1-hour TWAP"],
          ]}
        />
        <H2>Heartbeat and grace period</H2>
        <P>
          Markets expect a heartbeat (<Code>poke</Code>) at least every <B>60 seconds</B>. If the gap is longer, for example during a sequencer outage,
          the market enters a <B>10-minute grace period</B>: no new positions and no liquidations, so nobody is liquidated on a stale price.
          Closing and adding margin keep working. The <DocLink to="/docs/keeper">keeper</DocLink> sends heartbeats automatically, and anyone can poke from
          the token page.
        </P>
      </>
    ),
  },

  // ───────────────────────────── Reference
  {
    slug: "fees",
    group: "Reference",
    title: "Fees",
    summary: "Every fee in the protocol, in one place.",
    Body: () => (
      <Table
        head={["Action", "Fee", "Protocol", "Creator", "Vault"]}
        rows={[
          ["Create token", "Creation fee (flat)", "100%", "—", "—"],
          ["Swap before graduation", "1%", "0.50%", "0.25%", "0.25% (escrow)"],
          ["Anti-sniper tax", "start → 2%", "50%", "25% (locked)", "25% (escrow)"],
          ["Swap after graduation", "2%", "0.50%", "0.75%", "0.75%"],
          ["Creator tax (optional)", "0 – 10%", "0.5% of trade", "Rest", "—"],
          ["Perp open / close", "0.5% of notional", "0.2%", "—", "0.3%"],
          ["Funding", "≤ 0.1% / hour", "—", "—", "50%"],
          ["Liquidation", "≤ 1% of notional to liquidator", "—", "—", "Remainder"],
        ]}
      />
    ),
  },
  {
    slug: "parameters",
    group: "Reference",
    title: "Protocol parameters",
    summary: "Constants enforced by the contracts. Only G, the creation fee and the treasury can change, and only through the 48-hour timelock within hard bounds.",
    Body: () => (
      <>
        <H3>Launchpad</H3>
        <Table
          head={["Parameter", "Value"]}
          rows={[
            ["Total supply", "1,000,000,000"],
            ["In the pool at launch", "1,000,000,000 (all of it, one position)"],
            ["Pool", "Uniswap v4, HYPE/token, tick spacing 200, start tick 169,800"],
            ["Graduation target G", <GValue key="g" />],
            ["G bounds", "1 – 1,000,000 HYPE"],
            ["Creation fee bound", "≤ 10 HYPE"],
            ["Dev buy", "≤ 10% of supply, 3-day linear vesting"],
            ["Creator tax", "0 – 10%, Zephra keeps 0.5% of trade value"],
          ]}
        />
        <H3>Perp market</H3>
        <Table
          head={["Parameter", "Value"]}
          rows={[
            ["Warm-up", "30 minutes"],
            ["Low-leverage period", "24 hours (max 2x)"],
            ["TWAPs", "60 s mark · 180 s execution · 1 h settlement"],
            ["Max spot/TWAP deviation for opens", "3%"],
            ["Max impact", "0.5%"],
            ["Maintenance margin", "10% of notional"],
            ["Liquidation reward", "≤ 1% of notional"],
            ["Max funding", "0.1% per hour"],
            ["LP cooldown", "1 hour"],
            ["Close-only period", "72 hours"],
            ["Heartbeat gap / grace", "60 s / 10 minutes"],
          ]}
        />
      </>
    ),
  },
  {
    slug: "contracts",
    group: "Reference",
    title: "Smart contracts",
    summary: "Addresses for the deployment this interface is connected to, and what each contract does.",
    Body: () => {
      const d = getDeployment();
      const n = getNetwork();
      const rows: [string, string | undefined, string][] = [
        ["Hook / launchpad (ZephraV4Launchpad)", d?.launchpad, "Uniswap v4 hook and factory: creates tokens and pools, takes fees, graduation, claims"],
        ["ZephraRouter", d?.router, "Simple buy/sell router with minimum output and deadline"],
        ["ZephraQuoter", d?.quoter, "Price quotes for buys and sells"],
        ["Uniswap v4 PoolManager", d?.poolManager, "Holds every token's liquidity"],
        ["ZephraConfig", d?.config, "Admin (48 h timelock), guardian (pause), treasury, G and creation fee"],
        ["MarketFactory", d?.marketFactory, "Deploys a PerpMarket + vault per graduated token"],
        ["PoolViewFactory", d?.poolFactory, "Deploys the read-only pool view each perp market uses for prices"],
      ];
      return (
        <>
          <P>Network: <B>{n.name}</B> (chain ID {n.chainId}).</P>
          {!d && <Callout tone="warn">No deployment is configured in this build.</Callout>}
          <Table
            head={["Contract", "Address", "Role"]}
            rows={rows.map(([name, a, role]) => [
              name,
              a ? <a href={addrUrl(a)} target="_blank" rel="noreferrer" className="num break-all text-accent hover:underline">{a}</a> : <span className="text-faint">—</span>,
              role,
            ])}
          />
          <P>Per-token contracts (the token and its PerpMarket) are linked from each token's page under <B>About</B>.</P>
          {d && (
            <>
              <H2>Protocol wallets</H2>
              <Table
                head={["Wallet", "Address", "Role"]}
                rows={([
                  ["Admin", "0x11341c88Bbf32fF62741324d7B533CB65dBf2159", "Changes parameters through the 48-hour timelock"],
                  ["Guardian", "0x00ff4A225bc94724Da0286dF8D5fc8B00FFb35De", "Can pause new launches and new positions"],
                  ["Treasury", "0xb51AB221225470514985D931Fa948D7E1a43071E", "Receives protocol fees"],
                  ["Keeper", "0xFFCc2F1cB8beEe0B3D42071951e495bc90053A85", "Runs heartbeats, graduation, vault flushes, liquidations and settlements"],
                ] as [string, string, string][]).map(([name, a, role]) => [
                  name,
                  <a href={addrUrl(a)} target="_blank" rel="noreferrer" className="num break-all text-accent hover:underline">{a}</a>,
                  role,
                ])}
              />
            </>
          )}
          <H2>Admin powers and their limits</H2>
          <UL
            items={[
              <><B>Guardian</B>: can instantly pause new launches and new perp positions. Pausing never blocks closing positions, adding margin, selling or withdrawing.</>,
              <><B>Admin</B>: can change G, the creation fee, the treasury and roles, only through a <B>48-hour timelock</B> and within hard bounds.</>,
              "No function lets anyone withdraw user funds, pool liquidity or vault assets. Pool liquidity is a single permanent position.",
              <>Tokens are minimal clones of one ERC-20 (with permit) that has no owner, no mint, no transfer tax and no blacklist. The token contract exposes <Code>contractURI</Code> with the logo and metadata link.</>,
            ]}
          />
        </>
      );
    },
  },
  {
    slug: "keeper",
    group: "Reference",
    title: "Keeper",
    summary: "An off-chain bot that keeps every market healthy. Anyone can run one; every keeper action is permissionless.",
    Body: () => (
      <>
        <Table
          head={["Task", "Contract call", "Why"]}
          rows={[
            ["Heartbeat", "poke()", "Prevents the grace period and updates the oracle and funding"],
            ["Liquidations", "liquidate(trader)", "Protects the vault from bad debt"],
            ["Profit cap", "forceCloseAtCap(trader)", "Closes positions that hit 2/3 of notional"],
            ["LP withdrawals", "executeWithdraw(lp)", "Pays out requests after the 1 h cooldown"],
            ["Market status", "checkStatus()", "Moves markets to close-only, back to active, or closed"],
            ["Settlement", "settle(trader)", "Closes positions after a market is closed"],
            ["Graduation", "graduate(token)", "Opens the perp market once a token crossed the target"],
            ["Vault fees", "flushVault(token)", "Sends the perp vault's share of swap fees to its market"],
          ]}
        />
        <P>
          The reference keeper ships in the repository (<Code>keeper/</Code>) with a Docker setup and a small HTTP API
          (<Code>/health</Code>, <Code>/tokens</Code>). The keeper wallet on mainnet pays gas for heartbeats, liquidations and settlements.
        </P>
      </>
    ),
  },
  {
    slug: "security",
    group: "Reference",
    title: "Security & risks",
    summary: "How Zephra protects users, and the risks that remain.",
    Body: () => (
      <>
        <H2>Design protections</H2>
        <UL
          items={[
            "Non-custodial: funds are held by contracts, never by the interface or its operators.",
            "Plain ERC-20 tokens with fixed supply, no owner, no mint, no transfer tax and no blacklist.",
            "Locked dev buys with vesting, and permanently locked pool liquidity.",
            "Pessimistic perp pricing, deviation checks, OI caps, wallet caps and a profit cap.",
            "Heartbeat grace period against stale prices; timelocked, bounded admin.",
          ]}
        />
        <H2>Remaining risks</H2>
        <UL
          items={[
            "Smart contract risk: the contracts have not been externally audited yet.",
            "Market risk: launch tokens are extremely volatile and can lose all value.",
            "Liquidation risk on leveraged positions, and counterparty risk for vault LPs.",
            "Chain risk: Elysium uses a single sequencer; outages pause trading.",
          ]}
        />
        <P>Read the full <DocLink to="/legal/risk">Risk Disclosure</DocLink>.</P>
        <Callout title="Found a vulnerability?">Please report it privately to the team before disclosing it publicly.</Callout>
      </>
    ),
  },
  {
    slug: "faq",
    group: "Reference",
    title: "FAQ",
    summary: "Short answers to common questions.",
    Body: () => {
      const qa: [string, React.ReactNode][] = [
        ["Do I need an account?", "No. Zephra is non-custodial. Connecting a wallet is all you need."],
        ["Why did my buy pay a high fee?", "The token was in its anti-sniper window (or the creator set a creator tax). The tax decays to 2% and then the normal 1% fee applies. The fee preview shows the current rate before you confirm."],
        ["Why can't I open a perp right now?", "The market may be in its 30-minute warm-up, in close-only, in a heartbeat grace period, or spot may be more than 3% from the TWAP. The trade panel tells you which."],
        ["Why is my entry price different from the chart?", "Perp entries use the worse of spot and the 180 s TWAP plus a small impact. This protects the vault from manipulation."],
        ["Can the creator rug the liquidity?", "No. The pool liquidity is one permanent position that nobody can change, and dev tokens vest over 3 days."],
        ["Why is my vault withdrawal pending?", "Withdrawals have a 1-hour cooldown and execute at the NAV at execution time."],
        ["What happens if a token never graduates?", "Nothing special. The pool is permanent and always open, so you can sell at any time. The perp market just never opens."],
      ];
      return (
        <div className="mt-2 divide-y divide-line">
          {qa.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink">
                {q}
                <span className="text-xl leading-none text-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="mt-3 text-[15px] leading-7 text-muted">{a}</div>
            </details>
          ))}
        </div>
      );
    },
  },
  {
    slug: "glossary",
    group: "Reference",
    title: "Glossary",
    summary: "Terms used across Zephra.",
    Body: () => (
      <Table
        head={["Term", "Meaning"]}
        rows={[
          ["G", "Graduation target: the HYPE the pool must take in before the perp market opens."],
          ["Hook", "The contract attached to each Uniswap v4 pool that charges Zephra's fees and runs graduation."],
          ["TWAP", "Time-weighted average price, read from the spot pool."],
          ["Mark price", "60-second TWAP used for PnL and liquidations."],
          ["Notional", "Position size: margin × leverage."],
          ["OI", "Open interest: total notional of open positions on one side."],
          ["NAV", "Net asset value of a Perp Vault after unrealised trader PnL."],
          ["Funding", "Periodic payment from the heavier side of the market."],
          ["Keeper", "Bot that sends heartbeats and runs liquidations, withdrawals and status checks."],
          ["Grace period", "10-minute pause on opens and liquidations after a missed heartbeat."],
        ]}
      />
    ),
  },
];
