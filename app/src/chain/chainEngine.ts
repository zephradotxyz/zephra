// ChainEngine: the same interface as the base Engine, but every number comes from the deployed
// contracts and every action is a real transaction sent from the connected wallet.
// The current user is mapped to the `YOU` key so all existing UI works unchanged.
import { decodeEventLog, formatEther, maxUint256, parseEventLogs, type Abi, type Address, type Hash, type Log } from "viem";
import { Engine, YOU, ZephraError, type LaunchOptions, type Position, type Token } from "../engine/engine";
import { P } from "../engine/params";
import artifacts from "./artifacts.json";
import { getDeployment, getNetwork, API_URL, ipfsToHttp, type Deployment } from "./config";
import { publicClient, recordTx, updateTx, wallet, ensureChain } from "./wallet";

const A = {
  lp: artifacts.ZephraV4Launchpad.abi as Abi,
  cfg: artifacts.ZephraConfig.abi as Abi,
  router: artifacts.ZephraRouter.abi as Abi,
  mkt: artifacts.PerpMarket.abi as Abi,
  tok: artifacts.ZephraTokenV4.abi as Abi,
};
const ALL_ABI = [...A.lp, ...A.mkt, ...A.tok] as Abi;

// The single Uniswap v4 position every Zephra token is seeded with (matches ZephraV4Launchpad).
const START_TICK = 169_800;
const LOWER_TICK = 120_200;
const SQRT_U = Math.sqrt(1.0001 ** START_TICK);
const SQRT_L = Math.sqrt(1.0001 ** LOWER_TICK);
const LIQ = P.SUPPLY / (SQRT_U - SQRT_L);
const BASE_FEE = 0.01;
const GRAD_FEE = 0.02;

const n = (x: bigint) => Number(formatEther(x));
const toWei = (x: number) => (BigInt(Math.floor(Math.max(0, x) * 1e9)) * 1_000_000_000n) as bigint;
const STATES = ["warmup", "active", "closeonly", "closed"] as const;
// The public RPC rejects eth_getLogs ranges above ~2,000 blocks.
const CHUNK = 1_500n;
const PARALLEL = 6;

/** Friendly messages for contract revert reasons. */
const REASONS: Record<string, string> = {
  "tax 100%": "Tax is 100% right now — wait a few seconds",
  slippage: "Price moved — slippage exceeded",
  "not bonding": "This token is no longer on the bonding curve",
  "failed: call markFailed": "This token failed to graduate (sell-only)",
  "launch paused": "Launches are paused by the guardian",
  "creation fee": "Not enough HYPE for the creation fee",
  "dev buy > 10%": "Dev buy is capped at 10% of supply",
  "dev buy too large": "Dev buy is too large",
  "tax window": "Anti-sniper window must be off or 30–300 seconds",
  "start tax": "Start tax must be 10–100%",
  leverage: "Leverage is above this market's limit",
  "not active": "Market is not accepting new positions",
  paused: "New positions are paused by the guardian",
  "grace period": "Grace period: the market heartbeat was stale. Run the keeper (or poke) and wait up to 10 minutes",
  insider: "The creator cannot trade this token's perp",
  "position exists": "You already have a position on this side",
  "price deviation": "Spot/TWAP deviation is above 3% — wait for the price to settle",
  margin: "Margin is too small",
  "OI cap": "Open interest cap for this side is full",
  "wallet cap": "Exceeds the per-wallet limit (20% of cap)",
  "reduce-only": "Market is reduce-only",
  "no position": "No open position",
  "deposits closed": "Deposits are closed",
  "guarded cap": "Guarded launch: vault NAV cap reached",
  shares: "Not enough withdrawable shares",
  cooldown: "Withdrawal cooldown has not finished",
  "no free liquidity": "No free liquidity right now — your request stays queued",
  "settle positions first": "Waiting for all positions to settle",
  deadline: "Transaction expired — try again",
  "range exhausted": "Order is larger than what is left in the pool",
  "liquidity is locked": "Pool liquidity is permanently locked",
};

export function friendlyError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; details?: string };
  const msg = `${err.shortMessage ?? ""} ${err.details ?? ""} ${err.message ?? ""}`;
  const m = msg.match(/reason:\s*([^\n]+?)(?:\s{2,}|\n|$)/) || msg.match(/reverted with reason string '([^']+)'/);
  if (m) {
    const r = m[1].trim().replace(/^"|"$/g, "");
    return REASONS[r] ?? `Reverted: ${r}`;
  }
  if (/User rejected|denied/i.test(msg)) return "Transaction rejected in wallet";
  if (/insufficient funds/i.test(msg)) return "Insufficient HYPE for this transaction (including gas)";
  return err.shortMessage ?? err.message ?? String(e);
}

interface ChainExtra {
  pool?: Address;
  price: number; // HYPE per token, straight from the Uniswap v4 pool
  market?: Address;
  twap60: number;
  twap180: number;
  nav: number;
  cap: number;
  funding: number; // per second
  maxLev: number;
  reserved: number;
  free: number;
  sharePrice: number;
  devVested: number;
  myBal: bigint;
  vol72: number;
  vol: Record<number, number>; // hourly HYPE volume from Trade events
  lastHeartbeat: number;
  openKeys: Set<string>; // "trader:isLong" from events (for the keeper)
  lps: Set<string>; // addresses with withdrawal requests (for the keeper)
}

type CToken = Token & { chain: ChainExtra };

export class ChainEngine extends Engine {
  override readonly isChain = true;
  dep: Deployment | null;
  me: Address | null = null;
  block = 0n;
  syncedAt = 0; // wall-clock ms of the last sync
  chainNow = 0; // chain timestamp at the last sync
  ready = false;
  syncing = false;
  lastError = "";
  private cursor = 0n;
  private anchors: { b: bigint; t: number }[] = [];
  private tokenIndex = 0;

  constructor() {
    super(Math.floor(Date.now() / 1000));
    this.balances = {};
    this.dep = getDeployment();
    this.cursor = this.dep ? BigInt(this.dep.fromBlock || "0") : 0n;
  }

  private get pc() {
    return publicClient();
  }

  private mapWho(a: string) {
    return this.me && a.toLowerCase() === this.me.toLowerCase() ? YOU : a;
  }

  private ct(addr: string) {
    return this.token(addr) as CToken | undefined;
  }

  /** Advance the local clock between syncs so countdowns stay smooth. */
  tick() {
    if (this.chainNow) this.now = this.chainNow + Math.floor((Date.now() - this.syncedAt) / 1000);
  }

  // ==================================================================
  // Sync
  // ==================================================================

  private syncPromise: Promise<void> | null = null;

  /** Sync once; concurrent callers share the in-flight sync. */
  sync(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.doSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  /** Wait for any in-flight sync, then run a fresh one (state after our latest tx). */
  async syncFresh() {
    if (this.syncPromise) await this.syncPromise.catch(() => undefined);
    await this.sync();
  }

  private async doSync() {
    if (!this.dep) return;
    this.syncing = true;
    try {
      this.me = wallet.state.address;
      const pc = this.pc;
      const head = await pc.getBlock();
      this.block = head.number!;
      this.chainNow = Number(head.timestamp);
      this.syncedAt = Date.now();
      this.now = this.chainNow;

      const L = this.dep.launchpad;
      const [G, fee] = (await Promise.all([
        pc.readContract({ address: this.dep.config, abi: A.cfg, functionName: "gradTarget" }),
        pc.readContract({ address: this.dep.config, abi: A.cfg, functionName: "creationFee" }),
      ])) as [bigint, bigint];
      this.G = n(G);
      this.creationFee = n(fee);
      if (this.me) this.balances[YOU] = n(await pc.getBalance({ address: this.me }));
      else this.balances[YOU] = 0;

      // new tokens
      const count = Number((await pc.readContract({ address: L, abi: A.lp, functionName: "tokenCount" })) as bigint);
      for (; this.tokenIndex < count; this.tokenIndex++) {
        const addr = (await pc.readContract({ address: L, abi: A.lp, functionName: "allTokens", args: [BigInt(this.tokenIndex)] })) as Address;
        await this.addToken(addr);
      }

      await this.syncLogs();
      await Promise.all(this.tokens.map((t) => this.syncToken(t as CToken)));
      this.ready = true;
      this.lastError = "";
    } catch (e) {
      this.lastError = friendlyError(e);
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  private async addToken(addr: Address) {
    const pc = this.pc;
    const L = this.dep!.launchpad;
    const [name, symbol, params, meta] = (await Promise.all([
      pc.readContract({ address: addr, abi: A.tok, functionName: "name" }),
      pc.readContract({ address: addr, abi: A.tok, functionName: "symbol" }),
      pc.readContract({ address: L, abi: A.lp, functionName: "launchParams", args: [addr] }),
      pc.readContract({ address: L, abi: A.lp, functionName: "metadata", args: [addr] }),
    ])) as [string, string, [number, number, number, number], string];
    let m: Token["meta"] = {};
    const ipfsMeta = /^ipfs:\/\//.test(meta) ? meta : "";
    if (!ipfsMeta) {
      try {
        m = meta ? JSON.parse(meta) : {};
      } catch {
        m = { description: meta };
      }
    }
    const hue = parseInt(addr.slice(2, 6), 16) % 360;
    const t: CToken = {
      addr,
      name,
      symbol,
      description: m.description ?? "",
      hue,
      glyph: symbol.slice(0, 2).toUpperCase(),
      creator: "",
      createdAt: 0,
      lastTradeAt: 0,
      state: "bonding",
      realHYPE: 0,
      tokensSold: 0,
      creatorClaimable: 0,
      creatorLockedTax: 0,
      escrow: 0,
      devLocked: 0,
      devClaimed: 0,
      gradAt: 0,
      holders: {},
      trades: [],
      priceHist: [],
      cum: 0,
      lastCumTime: 0,
      obs: [],
      supply: P.SUPPLY,
      gradTarget: this.G,
      virtualHYPE: 0,
      taxWindow: Number(params[0]),
      startTax: Number(params[1]) / 10_000,
      levCap: Number(params[2]),
      creatorTax: Number(params[3] ?? 0) / 10_000,
      meta: m,
      heat: 0,
      chain: { price: 0, twap60: 0, twap180: 0, nav: 0, cap: 0, funding: 0, maxLev: 1, reserved: 0, free: 0, sharePrice: 1, devVested: 0, myBal: 0n, vol72: 0, vol: {}, lastHeartbeat: 0, openKeys: new Set(), lps: new Set() },
    };
    this.tokens.unshift(t);
    if (ipfsMeta) void this.loadIpfsMeta(t, ipfsMeta);
    await this.syncToken(t);
  }

  private async syncToken(t: CToken) {
    const pc = this.pc;
    const L = this.dep!.launchpad;
    const r = <T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) => pc.readContract({ address, abi, functionName, args }) as Promise<T>;
    const [c, [sTo, sBps], [px, tw60h, tw180h, vol72h]] = await Promise.all([
      r<readonly unknown[]>(L, A.lp, "info", [t.addr]),
      r<readonly [readonly Address[], readonly number[]]>(L, A.lp, "feeSplits", [t.addr]),
      Promise.all([
        r<bigint>(L, A.lp, "spotPrice", [t.addr]),
        r<bigint>(L, A.lp, "twapOf", [t.addr, 60n]),
        r<bigint>(L, A.lp, "twapOf", [t.addr, 180n]),
        r<bigint>(L, A.lp, "volume72hOf", [t.addr]),
      ]),
    ]);
    t.splits = sTo.map((to, i) => ({ to, bps: Number(sBps[i]) }));
    const [creator, state, createdAt, gradAt, lastTradeAt, gradTarget, netQuote, tokensSold, initialReserve, claimable, lockedTax, escrow, devLocked, devClaimed, pool, market] = c as [
      Address, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, Address, Address,
    ];
    t.creator = this.mapWho(creator);
    // v4 states: 1 live, 2 crossed (graduates on the next swap), 3 graduated
    const onchainState = (["bonding", "bonding", "bonding", "graduated"] as const)[Number(state)];
    // Only flip to "graduated" once the pool and market data below have been read; the UI
    // dereferences t.pool / t.market for graduated tokens, so a half-synced token would crash it.
    t.state = onchainState === "graduated" && (!t.pool || !t.market) ? t.state : onchainState;
    t.createdAt = Number(createdAt);
    t.lastTradeAt = Number(lastTradeAt);
    t.gradAt = Number(gradAt);
    t.gradTarget = n(gradTarget);
    t.virtualHYPE = 0;
    t.realHYPE = n(netQuote);
    t.tokensSold = n(tokensSold);
    t.creatorClaimable = n(claimable);
    t.creatorLockedTax = n(lockedTax);
    t.escrow = n(escrow);
    t.devLocked = n(devLocked);
    t.devClaimed = n(devClaimed);
    t.chain.price = n(px);
    t.chain.twap60 = n(tw60h);
    t.chain.twap180 = n(tw180h);
    t.chain.vol72 = n(vol72h);
    const [supply, devVested, myBal] = await Promise.all([
      r<bigint>(t.addr as Address, A.tok, "totalSupply"),
      r<bigint>(L, A.lp, "devVested", [t.addr]),
      this.me ? r<bigint>(t.addr as Address, A.tok, "balanceOf", [this.me]) : Promise.resolve(0n),
    ]);
    t.supply = n(supply);
    t.chain.devVested = n(devVested);
    t.chain.myBal = myBal;
    t.holders[YOU] = n(myBal);

    if (onchainState === "graduated" && market !== "0x0000000000000000000000000000000000000000") {
      t.chain.pool = pool;
      t.chain.market = market;
      const me = this.me ?? "0x0000000000000000000000000000000000000001";
      const [mState, activeAt, mGradAt, closeOnlyAt, settle, vaultCash, totalShares, longS, shortS, idxL, idxS, lastAcc, nav, cap, fr, maxLev, graceUntil, hb, reserved, free, sp, myShares, myLocked, wreq, posL, posS] =
        (await Promise.all([
          r(market, A.mkt, "state"),
          r(market, A.mkt, "activeAt"),
          r(market, A.mkt, "gradAt"),
          r(market, A.mkt, "closeOnlyAt"),
          r(market, A.mkt, "settlementPrice"),
          r(market, A.mkt, "vaultCash"),
          r(market, A.mkt, "totalShares"),
          r(market, A.mkt, "longSide"),
          r(market, A.mkt, "shortSide"),
          r(market, A.mkt, "fundIdxLong"),
          r(market, A.mkt, "fundIdxShort"),
          r(market, A.mkt, "lastAccrue"),
          r(market, A.mkt, "nav"),
          r(market, A.mkt, "capPerSide"),
          r(market, A.mkt, "fundingRate"),
          r(market, A.mkt, "maxLeverage"),
          r(market, A.mkt, "graceUntil"),
          r(market, A.mkt, "lastHeartbeat"),
          r(market, A.mkt, "reserved"),
          r(market, A.mkt, "freeLiquidity"),
          r(market, A.mkt, "sharePrice"),
          r(market, A.mkt, "shares", [me]),
          r(market, A.mkt, "lockedShares", [me]),
          r(market, A.mkt, "withdrawReq", [me]),
          r(market, A.mkt, "getPosition", [me, true]),
          r(market, A.mkt, "getPosition", [me, false]),
        ])) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      // the v4 pool, shown through the same fields the UI already reads
      t.pool = { rH: n(netQuote), rT: P.SUPPLY - n(tokensSold), initialRH: n(initialReserve), creatorFees: 0, protoFees: 0, vol: t.chain.vol };
      const prev = t.market;
      // sumSnap on-chain = sum(notional_wei * idx_wad) / 1e18 → divide by 1e18 again for HYPE * index
      const side = (s: readonly bigint[]) => ({ notional: n(s[0]), size: n(s[1]), sumSnap: Number(s[2]) / 1e18 });
      const positions: Position[] = [];
      for (const [isLong, ps] of [[true, posL], [false, posS]] as const) {
        if (ps.notional > 0n) {
          positions.push({ trader: YOU, isLong, margin: n(ps.margin), notional: n(ps.notional), size: n(ps.size), entry: Number(ps.notional) / Number(ps.size), fundSnap: Number(ps.fundSnap) / 1e18, openedAt: Number(ps.openedAt) });
        }
      }
      t.market = {
        state: STATES[Number(mState)],
        gradAt: Number(mGradAt),
        activeAt: Number(activeAt),
        closeOnlyAt: Number(closeOnlyAt),
        settlementPrice: n(settle),
        vaultCash: n(vaultCash),
        totalShares: n(totalShares),
        shares: { [YOU]: n(myShares) },
        locked: { [YOU]: n(myLocked) },
        wreq: wreq[0] > 0n ? { [YOU]: { shares: n(wreq[0]), readyAt: Number(wreq[1]) } } : {},
        positions,
        long: side(longS),
        short: side(shortS),
        idxL: Number(idxL) / 1e18,
        idxS: Number(idxS) / 1e18,
        lastAccrue: Number(lastAcc),
        protoFees: 0,
        lastHeartbeat: Number(hb),
        graceUntil: Number(graceUntil),
        feesToVault: prev?.feesToVault ?? 0,
        navHist: prev?.navHist ?? [],
      };
      t.state = "graduated"; // pool + market are populated now
      Object.assign(t.chain, {
        nav: n(nav),
        cap: n(cap),
        funding: Number(fr) / 1e18,
        maxLev: Number(maxLev),
        reserved: n(reserved),
        free: n(free),
        sharePrice: n(sp),
        lastHeartbeat: Number(hb),
      });
      const last = t.market.navHist[t.market.navHist.length - 1];
      if (!last || this.now - last.t >= 60) t.market.navHist.push({ t: this.now, v: t.chain.nav });
    }
    // live price point
    const p = this.spot(t);
    const lastP = t.priceHist[t.priceHist.length - 1];
    if (p > 0 && (!lastP || this.now - lastP.t >= 5)) t.priceHist.push({ t: this.now, p });
  }

  /** Estimate a block's timestamp by interpolating between known anchors (fast, no extra RPC calls). */
  private tsOf(b: bigint) {
    const a = this.anchors;
    if (!a.length) return this.now;
    let lo = a[0];
    let hi = a[a.length - 1];
    for (const x of a) {
      if (x.b <= b && x.b >= lo.b) lo = x;
      if (x.b >= b && x.b <= hi.b) hi = x;
    }
    if (hi.b === lo.b) return lo.t;
    return Math.round(lo.t + ((hi.t - lo.t) * Number(b - lo.b)) / Number(hi.b - lo.b));
  }

  private async syncLogs() {
    const pc = this.pc;
    const L = this.dep!.launchpad;
    while (this.cursor <= this.block) {
      const markets = this.tokens.map((t) => (t as CToken).chain.market).filter(Boolean) as Address[];
      const toks = this.tokens.map((t) => t.addr as Address);
      const addrs = [L, ...markets, ...toks];
      // Fetch several chunks at once, then apply their logs in block order.
      const ranges: { from: bigint; to: bigint }[] = [];
      for (let c = this.cursor; c <= this.block && ranges.length < PARALLEL; c += CHUNK) {
        ranges.push({ from: c, to: c + CHUNK - 1n > this.block ? this.block : c + CHUNK - 1n });
      }
      const res = await Promise.all(
        ranges.map(async (g) => {
          const [bFrom, bTo, logs] = await Promise.all([
            pc.getBlock({ blockNumber: g.from }),
            pc.getBlock({ blockNumber: g.to }),
            pc.getLogs({ address: addrs, fromBlock: g.from, toBlock: g.to }),
          ]);
          return { g, bFrom, bTo, logs };
        })
      );
      for (const x of res) {
        this.anchors.push({ b: x.g.from, t: Number(x.bFrom.timestamp) }, { b: x.g.to, t: Number(x.bTo.timestamp) });
        for (const lg of x.logs) this.applyLog(lg);
        this.cursor = x.g.to + 1n;
      }
    }
  }

  private findBy(field: "market", a: string) {
    const x = a.toLowerCase();
    return this.tokens.find((t) => (t as CToken).chain[field]?.toLowerCase() === x) as CToken | undefined;
  }

  private applyLog(lg: Log) {
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: ALL_ABI, data: lg.data, topics: lg.topics }) as unknown as typeof ev;
    } catch {
      return;
    }
    const time = this.tsOf(lg.blockNumber!);
    const a = ev.args;
    const addTrade = (t: CToken, kind: string, venue: Token["trades"][number]["venue"], hype: number, tokens: number, price: number, who: string) => {
      t.trades.unshift({ id: Number(lg.blockNumber! % 1_000_000_000n) * 1000 + (lg.logIndex ?? 0), t: time, who: this.mapWho(who), kind, venue, hype, tokens, price });
      if (t.trades.length > 5000) t.trades.length = 5000;
      if (venue === "curve" || venue === "spot") {
        t.priceHist.push({ t: time, p: price });
        t.priceHist.sort((x, y) => x.t - y.t);
      }
    };
    const src = lg.address.toLowerCase();
    if (src === this.dep!.launchpad.toLowerCase()) {
      const t = this.ct(a.token as string);
      if (!t) return;
      if (ev.eventName === "TokenImage") {
        const img = String(a.image ?? "");
        if (/^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/)/.test(img)) t.image = img;
        return;
      }
      if (ev.eventName === "Trade") {
        const hype = n(a.hypeAmount as bigint);
        const tokens = n(a.tokenAmount as bigint);
        // buys: the price excludes the fee; sells: hypeAmount is already the gross amount
        const net = a.isBuy ? hype - n(a.fee as bigint) : hype;
        const venue = t.gradAt && time >= t.gradAt ? "spot" : "curve";
        addTrade(t, a.isBuy ? "buy" : "sell", venue, hype, tokens, tokens > 0 ? net / tokens : 0, a.trader as string);
        const h = Math.floor(time / 3600);
        t.chain.vol[h] = (t.chain.vol[h] ?? 0) + hype;
      }
      return;
    }
    const mt = this.findBy("market", src);
    if (mt) {
      const key = `${a.trader}:${a.isLong}`;
      if (ev.eventName === "Open") {
        mt.chain.openKeys.add(key);
        addTrade(mt, a.isLong ? "long" : "short", "perp", n(a.notional as bigint), 0, n(a.price as bigint), a.trader as string);
        if (mt.market) mt.market.feesToVault += n(a.notional as bigint) * P.PERP_FEE_VAULT;
      } else if (ev.eventName === "Close") {
        mt.chain.openKeys.delete(key);
        const kinds = ["close", "profit cap", "liquidated", "settle"];
        addTrade(mt, kinds[Number(a.kind)] ?? "close", "perp", n(a.payout as bigint), 0, n(a.price as bigint), a.trader as string);
      } else if (ev.eventName === "Deposit") {
        addTrade(mt, "deposit", "vault", n(a.amount as bigint), n(a.shares as bigint), 0, a.lp as string);
      } else if (ev.eventName === "Withdraw") {
        addTrade(mt, "withdraw", "vault", n(a.amount as bigint), n(a.sharesBurned as bigint), 0, a.lp as string);
        if ((a.sharesLeft as bigint) === 0n) mt.chain.lps.delete(a.lp as string);
      } else if (ev.eventName === "WithdrawRequested") {
        if ((a.shares as bigint) > 0n) mt.chain.lps.add(a.lp as string);
        else mt.chain.lps.delete(a.lp as string);
      } else if (ev.eventName === "SpotFee") {
        if (mt.market) mt.market.feesToVault += n((a.devPart as bigint) + (a.lpPart as bigint));
      }
      return;
    }
    if (ev.eventName === "Transfer") {
      const t = this.ct(lg.address);
      if (!t) return;
      const v = n(a.value as bigint);
      const from = this.mapWho(a.from as string);
      const to = this.mapWho(a.to as string);
      const skip = new Set([this.dep!.launchpad.toLowerCase(), (this.dep!.poolManager ?? "").toLowerCase(), "0x0000000000000000000000000000000000000000"]);
      if (!skip.has(String(a.from).toLowerCase()) && from !== YOU) t.holders[from] = (t.holders[from] ?? 0) - v;
      if (!skip.has(String(a.to).toLowerCase()) && to !== YOU) t.holders[to] = (t.holders[to] ?? 0) + v;
    }
  }

  // ==================================================================
  // View overrides (use on-chain values)
  // ==================================================================

  override twap(t: Token, window: number) {
    const c = (t as CToken).chain;
    if (window <= 60) return c.twap60 || this.spot(t);
    return c.twap180 || this.spot(t);
  }
  override nav(t: Token) {
    return (t as CToken).chain.nav;
  }
  override capPerSide(t: Token) {
    return (t as CToken).chain.cap;
  }
  override reserved(t: Token) {
    return (t as CToken).chain.reserved;
  }
  override freeLiquidity(t: Token) {
    return (t as CToken).chain.free;
  }
  override sharePrice(t: Token) {
    return (t as CToken).chain.sharePrice;
  }
  override fundingRate(t: Token) {
    return (t as CToken).chain.funding;
  }
  override maxLeverage(t: Token) {
    return (t as CToken).chain.maxLev;
  }
  override devVested(t: Token) {
    return (t as CToken).chain.devVested;
  }
  override volume72h(t: Token) {
    return (t as CToken).chain.vol72;
  }
  override marketState(t: Token) {
    return t.market ? t.market.state : null;
  }
  override advance() {
    /* time is driven by the chain */
  }
  override simulateOutage() {
    /* not available on-chain */
  }

  heartbeatStale(t: Token) {
    const c = (t as CToken).chain;
    return !!c.market && this.now - c.lastHeartbeat > 60;
  }

  // ==================================================================
  // Transactions
  // ==================================================================

  private async tx(label: string, address: Address, abi: Abi, functionName: string, args: unknown[] = [], value?: bigint) {
    await ensureChain();
    const wc = wallet.client();
    const account = wallet.state.address!;
    const pc = this.pc;
    const { request } = await pc.simulateContract({ address, abi, functionName, args, value, account } as never).catch((e) => {
      throw new ZephraError(friendlyError(e));
    });
    let hash: Hash;
    try {
      // sign with the wallet's own account: the injected wallet
      hash = await wc.writeContract({ ...(request as object), account: wc.account ?? account, chain: wc.chain } as never);
    } catch (e) {
      throw new ZephraError(friendlyError(e));
    }
    recordTx(hash, label);
    const rc = await pc.waitForTransactionReceipt({ hash });
    updateTx(hash, rc.status === "success" ? "success" : "failed");
    if (rc.status !== "success") throw new ZephraError(`${label} failed on-chain`);
    this.lastTx = hash;
    await this.syncFresh();
    return rc;
  }
  lastTx: Hash | null = null;

  private requireDep() {
    if (!this.dep) throw new ZephraError("Zephra is not deployed on this network yet");
    if (!wallet.state.address) throw new ZephraError("Connect a wallet first");
    return this.dep;
  }

  private async ensureAllowance(token: Address, spender: Address, amount: bigint) {
    const cur = (await this.pc.readContract({ address: token, abi: A.tok, functionName: "allowance", args: [wallet.state.address!, spender] })) as bigint;
    if (cur < amount) await this.tx("Approve", token, A.tok, "approve", [spender, maxUint256]);
  }

  private tokenAmount(t: CToken, x: number) {
    // use the exact on-chain balance for "max" sells
    const bal = t.chain.myBal;
    const w = toWei(x);
    if (bal > 0n && (w >= bal || Math.abs(x - n(bal)) <= n(bal) * 1e-6)) return bal;
    return w;
  }

  /** Metadata stored as ipfs://CID: fetch the JSON (name, description, image, links) once. */
  private async loadIpfsMeta(t: CToken, uri: string) {
    const url = ipfsToHttp(uri);
    if (!url) return;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { description?: string; image?: string; links?: { website?: string; x?: string; telegram?: string } };
        const safe = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);
        t.meta = { description: String(j.description ?? "").slice(0, 500) || undefined, website: safe(j.links?.website), x: safe(j.links?.x), telegram: safe(j.links?.telegram) };
        t.description = t.meta.description ?? "";
        if (typeof j.image === "string" && j.image.startsWith("ipfs://")) t.image = ipfsToHttp(j.image) || undefined;
        this.emit();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
  }

  // @ts-expect-error async override (UI awaits promises via act())
  override async createToken(_who: string, o: LaunchOptions) {
    const dep = this.requireDep();
    const { name, symbol, tw, st, lc, ct } = Engine.checkLaunch(o);
    // With an API configured, logo + metadata go to IPFS and only ipfs://CID is stored on-chain.
    // Without one (local dev), the old on-chain path is used: JSON metadata + data-URI logo.
    let meta = JSON.stringify({ description: o.description || undefined, website: o.website || undefined, x: o.x || undefined, telegram: o.telegram || undefined });
    let image = o.image ?? "";
    if (API_URL) {
      const r = await fetch(`${API_URL}/ipfs/launch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, symbol, description: o.description, website: o.website, x: o.x, telegram: o.telegram, image: o.image || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.metadataURI) throw new Error(`Metadata upload failed: ${j.error || r.status}`);
      meta = j.metadataURI;
      image = "";
    }
    const value = toWei(this.creationFee) + toWei(o.devBuy ?? 0);
    const rc = await this.tx(`Launch ${symbol}`, dep.launchpad, A.lp, "createAdvanced", [name, symbol, meta, image, { taxWindow: tw, startTaxBps: Math.round(st * 10_000), perpMaxLeverage: lc, creatorTaxBps: Math.round(ct * 10_000) }, 0n], value);
    const evs = parseEventLogs({ abi: A.lp, logs: rc.logs, eventName: "TokenCreated" }) as unknown as { args: { token: Address } }[];
    const addr = evs[0]?.args.token;
    for (let i = 0; i < 10 && addr && !this.token(addr); i++) {
      await new Promise((r) => setTimeout(r, 400));
      await this.syncFresh();
    }
    return addr ? this.token(addr) : undefined;
  }

  private async routerBuy(t: CToken, hypeIn: number, minOut: number) {
    const dep = this.requireDep();
    if (!dep.router) throw new ZephraError("Router address is not configured");
    await this.tx(`Buy ${t.symbol}`, dep.router, A.router, "buy", [t.addr, toWei(minOut), BigInt(this.chainNow + 600)], toWei(hypeIn));
  }

  private async routerSell(t: CToken, tokensIn: number, minOut: number) {
    const dep = this.requireDep();
    if (!dep.router) throw new ZephraError("Router address is not configured");
    const amt = this.tokenAmount(t, tokensIn);
    await this.ensureAllowance(t.addr as Address, dep.router, amt);
    await this.tx(`Sell ${t.symbol}`, dep.router, A.router, "sell", [t.addr, amt, toWei(minOut), BigInt(this.chainNow + 600)]);
    return n(amt);
  }

  // @ts-expect-error async override
  override async curveBuy(_who: string, addr: string, hypeIn: number, minOut = 0) {
    const t = this.ct(addr)!;
    const q = this.quoteCurveBuy(t, hypeIn);
    await this.routerBuy(t, hypeIn, minOut);
    return q;
  }

  // @ts-expect-error async override
  override async curveSell(_who: string, addr: string, tokensIn: number, minOut = 0) {
    const t = this.ct(addr)!;
    const q = this.quoteCurveSell(t, tokensIn);
    await this.routerSell(t, tokensIn, minOut);
    return q;
  }

  // @ts-expect-error async override
  override async spotBuy(_who: string, addr: string, hypeIn: number, minOut = 0) {
    const t = this.ct(addr)!;
    const q = this.quoteSpotBuy(t, hypeIn);
    await this.routerBuy(t, hypeIn, minOut);
    return q;
  }

  // @ts-expect-error async override
  override async spotSell(_who: string, addr: string, tokensIn: number, minOut = 0) {
    const t = this.ct(addr)!;
    const q = this.quoteSpotSell(t, tokensIn);
    await this.routerSell(t, tokensIn, minOut);
    return q;
  }

  // @ts-expect-error async override
  override async openPosition(_who: string, addr: string, isLong: boolean, notional: number, margin: number) {
    this.requireDep();
    const t = this.ct(addr)!;
    const N = toWei(notional);
    const fee = (N * 50n) / 10_000n;
    const price = this.execPrice(t, isLong, true, notional);
    await this.tx(`${isLong ? "Long" : "Short"} ${t.symbol}`, t.chain.market!, A.mkt, "open", [isLong, N], toWei(margin) + fee);
    return { price, size: notional / price, fee: n(fee) };
  }

  override async addMargin(_who: string, addr: string, isLong: boolean, amt: number) {
    const t = this.ct(addr)!;
    await this.tx(`Add margin ${t.symbol}`, t.chain.market!, A.mkt, "addMargin", [isLong], toWei(amt));
  }

  // @ts-expect-error async override
  override async closePosition(_who: string, addr: string, isLong: boolean) {
    const t = this.ct(addr)!;
    const ps = this.getPosition(t, YOU, isLong);
    const est = ps ? this.positionPnl(t, ps, this.execPrice(t, isLong, false, ps.notional)) : { pnl: 0, owed: 0 };
    const payout = ps ? Math.max(0, ps.margin + est.pnl - est.owed - ps.notional * P.PERP_FEE) : 0;
    const fn = t.market?.state === "closed" ? "settle" : "close";
    const args = fn === "settle" ? [wallet.state.address, isLong] : [isLong];
    await this.tx(`Close ${t.symbol}`, t.chain.market!, A.mkt, fn, args);
    return { pnl: est.pnl, payout };
  }

  // @ts-expect-error async override
  override async deposit(_who: string, addr: string, amt: number) {
    const t = this.ct(addr)!;
    const sh = amt / (this.sharePrice(t) || 1);
    await this.tx(`Deposit to ${t.symbol} vault`, t.chain.market!, A.mkt, "deposit", [], toWei(amt));
    return sh;
  }

  override async requestWithdraw(_who: string, addr: string, sh: number) {
    const t = this.ct(addr)!;
    await this.tx(`Request ${t.symbol} withdrawal`, t.chain.market!, A.mkt, "requestWithdraw", [toWei(sh)]);
  }

  override async cancelWithdraw(_who: string, addr: string) {
    const t = this.ct(addr)!;
    await this.tx(`Cancel ${t.symbol} withdrawal`, t.chain.market!, A.mkt, "cancelWithdraw");
  }

  // @ts-expect-error async override
  override async executeWithdraw(_who: string, addr: string) {
    const t = this.ct(addr)!;
    await this.tx(`Execute ${t.symbol} withdrawal`, t.chain.market!, A.mkt, "executeWithdraw", [wallet.state.address]);
    return 0;
  }

  // @ts-expect-error async override
  override async setFeeSplits(_who: string, addr: string, splits: { to: string; bps: number }[]) {
    const dep = this.requireDep();
    const t = this.ct(addr)!;
    Engine.checkSplits(splits);
    await this.tx(`Set ${t.symbol} fee splits`, dep.launchpad, A.lp, "setFeeSplits", [t.addr, splits.map((s) => s.to as Address), splits.map((s) => s.bps)]);
    await this.syncFresh();
    return splits;
  }

  // @ts-expect-error async override
  override async claimCreator(_who: string, addr: string) {
    const dep = this.requireDep();
    const t = this.ct(addr)!;
    let hype = 0;
    let tokens = 0;
    if (t.creatorClaimable > 0) {
      hype += t.creatorClaimable;
      await this.tx(`Claim ${t.symbol} creator fees`, dep.launchpad, A.lp, "claimCreator", [addr]);
    }
    const dev = t.chain.devVested - t.devClaimed;
    if (dev > 0) {
      tokens = dev;
      await this.tx(`Claim ${t.symbol} dev tokens`, dep.launchpad, A.lp, "claimDev", [addr]);
    }
    if (hype <= 0 && tokens <= 0) throw new ZephraError("Nothing to claim yet");
    return { hype, tokens };
  }

  /** Pays out the creator fees of every token this wallet launched, in batches of 25. */
  async claimAllFees() {
    const dep = this.requireDep();
    const me = wallet.state.address;
    if (!me) throw new ZephraError("Connect your wallet first");
    const count = Number((await this.pc.readContract({ address: dep.launchpad, abi: A.lp, functionName: "creatorTokenCount", args: [me] })) as bigint);
    if (count === 0) throw new ZephraError("You have not launched any token");
    const total = n((await this.pc.readContract({ address: dep.launchpad, abi: A.lp, functionName: "creatorClaimableTotal", args: [me] })) as bigint);
    if (total <= 0) throw new ZephraError("No fees to claim yet");
    for (let from = 0; from < count; from += 25) {
      await this.tx("Claim all creator fees", dep.launchpad, A.lp, "claimAll", [me, BigInt(from), BigInt(Math.min(count, from + 25))]);
    }
    return { hype: total };
  }

  override async markFailed(_addr: string) {
    throw new ZephraError("Tokens no longer fail: the pool is permanent and always open");
  }

  override failable(_t: Token) {
    return false;
  }

  // ---- pricing: constant-liquidity Uniswap v4 position (same maths as the pool) ----
  private sqrtNow(t: Token) {
    const p = (t as CToken).chain.price;
    return p > 0 ? Math.sqrt(1 / p) : SQRT_U;
  }
  override curvePrice(t: Token) {
    return (t as CToken).chain.price;
  }
  override spot(t: Token) {
    return (t as CToken).chain.price;
  }
  override buyFee(t: Token) {
    if (t.state === "graduated") return { rate: GRAD_FEE, isTax: false };
    return super.buyFee(t);
  }
  private v4Buy(t: Token, hypeIn: number, rate: number) {
    const fee = hypeIn * rate;
    const sq = this.sqrtNow(t);
    const x1 = 1 / sq + (hypeIn - fee) / LIQ;
    const sq2 = Math.max(SQRT_L, 1 / x1);
    return { out: Math.max(0, LIQ * (sq - sq2)), fee, used: hypeIn, rate };
  }
  private v4Sell(t: Token, tokensIn: number) {
    const sq = this.sqrtNow(t);
    const sq2 = Math.min(SQRT_U, sq + tokensIn / LIQ);
    const gross = LIQ * (1 / sq - 1 / sq2);
    const fee = gross * ((t.state === "graduated" ? GRAD_FEE : BASE_FEE) + t.creatorTax);
    return { out: gross - fee, fee, gross };
  }
  override quoteCurveBuy(t: Token, hypeIn: number, rateOverride?: number) {
    const rate = Math.min(rateOverride ?? this.buyFee(t).rate + t.creatorTax, 0.9999);
    return this.v4Buy(t, hypeIn, rate);
  }
  override quoteCurveSell(t: Token, tokensIn: number) {
    return this.v4Sell(t, tokensIn);
  }
  override quoteSpotBuy(t: Token, hypeIn: number) {
    return this.v4Buy(t, hypeIn, Math.min(this.buyFee(t).rate + t.creatorTax, 0.9999));
  }
  override quoteSpotSell(t: Token, tokensIn: number) {
    return this.v4Sell(t, tokensIn);
  }

  async poke(addr: string) {
    const t = this.ct(addr)!;
    await this.tx(`Poke ${t.symbol}`, t.chain.market!, A.mkt, "poke");
  }

  // keeper helpers
  keeperView() {
    return this.tokens.map((t) => t as CToken);
  }
}


export const abis = A;
export { getNetwork };
