// Zephra engine: mirrors the smart contract logic (Launchpad, Pool, PerpMarket) (base class for ChainEngine).
// Amounts are in HYPE (float). Constants in params.ts match the contracts.
import { P } from "./params";

export type TokenState = "bonding" | "graduated" | "failed";
export type MarketState = "warmup" | "active" | "closeonly" | "closed";
export type Venue = "curve" | "spot" | "perp" | "vault";

export interface Trade {
  id: number;
  t: number;
  who: string;
  kind: string; // buy, sell, long, short, close, liquidated, deposit, withdraw...
  venue: Venue;
  hype: number;
  tokens: number;
  price: number;
}

export interface Position {
  trader: string;
  isLong: boolean;
  margin: number;
  notional: number;
  size: number;
  entry: number;
  fundSnap: number;
  openedAt: number;
}

interface SideAgg {
  notional: number;
  size: number;
  sumSnap: number;
}

export interface Pool {
  rH: number;
  rT: number;
  initialRH: number;
  creatorFees: number;
  protoFees: number;
  vol: Record<number, number>; // hour -> HYPE volume
}

export interface Market {
  state: MarketState;
  gradAt: number;
  activeAt: number;
  closeOnlyAt: number;
  settlementPrice: number;
  vaultCash: number;
  totalShares: number;
  shares: Record<string, number>;
  locked: Record<string, number>;
  wreq: Record<string, { shares: number; readyAt: number }>;
  positions: Position[];
  long: SideAgg;
  short: SideAgg;
  idxL: number;
  idxS: number;
  lastAccrue: number;
  protoFees: number;
  lastHeartbeat: number;
  graceUntil: number;
  feesToVault: number; // stats: total vault income
  navHist: { t: number; v: number }[];
}

export interface Token {
  addr: string;
  name: string;
  symbol: string;
  description: string;
  hue: number;
  glyph: string;
  image?: string; // logo (data URI or URL)
  /** creator fee splits (empty = everything to the creator) */
  splits?: { to: string; bps: number }[];
  creator: string;
  createdAt: number;
  lastTradeAt: number;
  state: TokenState;
  realHYPE: number;
  tokensSold: number;
  creatorClaimable: number;
  creatorLockedTax: number;
  escrow: number;
  devLocked: number;
  devClaimed: number;
  gradAt: number;
  holders: Record<string, number>;
  trades: Trade[];
  priceHist: { t: number; p: number }[];
  cum: number;
  lastCumTime: number;
  obs: { t: number; cum: number }[];
  pool?: Pool;
  market?: Market;
  supply: number;
  // per-token launch settings (creator-chosen, within protocol bounds)
  gradTarget: number; // G for this token
  virtualHYPE: number; // V0 for this token
  taxWindow: number; // seconds, 0 = no anti-sniper tax
  startTax: number; // 0.1 - 1.0
  levCap: number; // 1 - 3
  creatorTax: number; // 0 - 0.10, permanent tax on every buy and sell, paid to the creator
  meta: TokenMeta;
  // bot behaviour (demo)
  heat: number;
  heatAfter?: number;
}

export interface TokenMeta {
  description?: string;
  website?: string;
  x?: string;
  telegram?: string;
}

export interface LaunchOptions {
  name: string;
  symbol: string;
  description?: string;
  hue?: number;
  glyph?: string;
  devBuy?: number;
  image?: string;
  taxWindow?: number;
  startTax?: number;
  levCap?: number;
  creatorTax?: number;
  website?: string;
  x?: string;
  telegram?: string;
}

export interface Activity {
  id: number;
  t: number;
  text: string;
  token?: string;
  tone: "up" | "down" | "info";
}

export const YOU = "0xYou";
const TREASURY = "0xZephraTreasury";

let tradeSeq = 1;

// ----------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class ZephraError extends Error {}
const fail = (msg: string): never => {
  throw new ZephraError(msg);
};

// ----------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------

export class Engine {
  now: number;
  tokens: Token[] = [];
  balances: Record<string, number> = {};
  activity: Activity[] = [];
  protocolAccrued = 0;
  rand: () => number;
  version = 0;
  private listeners = new Set<() => void>();
  private actSeq = 1;
  outage = false;
  /** Graduation target G and creation fee for new tokens (chain mode reads them from ZephraConfig). */
  G: number = P.G;
  creationFee: number = P.CREATION_FEE;
  readonly isChain: boolean = false;

  constructor(startTime: number, seed = 7) {
    this.now = startTime;
    this.rand = rng(seed);
    this.balances[YOU] = 2500;
  }

  // ---------------- subscribe ----------------
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  log(text: string, tone: Activity["tone"] = "info", token?: string) {
    this.activity.unshift({ id: this.actSeq++, t: this.now, text, tone, token });
    if (this.activity.length > 200) this.activity.length = 200;
  }

  bal(who: string) {
    return this.balances[who] ?? 0;
  }
  private pay(who: string, amt: number) {
    this.balances[who] = this.bal(who) + amt;
  }
  private take(who: string, amt: number) {
    if (this.bal(who) + 1e-12 < amt) fail("Insufficient HYPE balance");
    this.balances[who] = this.bal(who) - amt;
  }

  token(addr: string) {
    return this.tokens.find((t) => t.addr === addr);
  }

  // ==================================================================
  // Prices & oracle
  // ==================================================================

  curvePrice(t: Token) {
    return (t.virtualHYPE + t.realHYPE) / (P.VIRTUAL_TOKENS - t.tokensSold);
  }

  spot(t: Token) {
    if (t.pool) return t.pool.rH / t.pool.rT;
    return this.curvePrice(t);
  }

  price(t: Token) {
    return this.spot(t);
  }

  marketCap(t: Token) {
    return this.price(t) * t.supply;
  }

  progress(t: Token) {
    if (t.state === "graduated") return 1;
    return Math.min(1, t.realHYPE / t.gradTarget);
  }

  private updateOracle(t: Token) {
    if (this.now > t.lastCumTime) {
      t.cum += this.spot(t) * (this.now - t.lastCumTime);
      t.lastCumTime = this.now;
      const last = t.obs[t.obs.length - 1];
      if (!last || this.now - last.t >= P.OBS_SPACING) {
        t.obs.push({ t: this.now, cum: t.cum });
        if (t.obs.length > 420) t.obs.shift();
      }
    }
  }

  twap(t: Token, window: number) {
    if (!t.obs.length) return this.spot(t);
    const target = this.now - window;
    let o = t.obs[0];
    for (let i = t.obs.length - 1; i >= 0; i--) {
      if (t.obs[i].t <= target) {
        o = t.obs[i];
        break;
      }
    }
    if (o.t >= this.now) return this.spot(t);
    const cumNow = t.cum + this.spot(t) * (this.now - t.lastCumTime);
    return (cumNow - o.cum) / (this.now - o.t);
  }

  private recordPrice(t: Token) {
    const p = this.spot(t);
    const last = t.priceHist[t.priceHist.length - 1];
    if (last && this.now - last.t < 5) last.p = p;
    else t.priceHist.push({ t: this.now, p });
    if (t.priceHist.length > 6000) t.priceHist.splice(0, 1000);
  }

  private addTrade(t: Token, tr: Omit<Trade, "id" | "t">) {
    t.trades.unshift({ id: tradeSeq++, t: this.now, ...tr });
    if (t.trades.length > 300) t.trades.length = 300;
  }

  // ==================================================================
  // Launchpad
  // ==================================================================

  buyFee(t: Token): { rate: number; isTax: boolean } {
    const el = this.now - t.createdAt;
    if (t.taxWindow > 0 && el < t.taxWindow && t.startTax > P.BOND_FEE) {
      const r = t.startTax - ((t.startTax - P.TAX_END) * el) / t.taxWindow;
      return { rate: Math.max(P.TAX_END, r), isTax: true };
    }
    return { rate: P.BOND_FEE, isTax: false };
  }

  quoteCurveBuy(t: Token, hypeIn: number, rateOverride?: number) {
    let rate = rateOverride ?? this.buyFee(t).rate;
    if (rateOverride === undefined && rate < 1) rate = Math.min(rate + t.creatorTax, 0.9999);
    if (rate >= 1) return { out: 0, fee: hypeIn, used: hypeIn, rate };
    let used = hypeIn;
    let fee = hypeIn * rate;
    let net = hypeIn - fee;
    const room = t.gradTarget - t.realHYPE;
    let last = false;
    if (net >= room) {
      net = room;
      used = net / (1 - rate);
      fee = used - net;
      last = true;
    }
    const vH = t.virtualHYPE + t.realHYPE;
    const vT = P.VIRTUAL_TOKENS - t.tokensSold;
    let out = (vT * net) / (vH + net);
    const left = P.CURVE_SUPPLY - t.tokensSold;
    if (out > left || last) out = left;
    return { out, fee, used, rate };
  }

  quoteCurveSell(t: Token, tokensIn: number) {
    const vH = t.virtualHYPE + t.realHYPE;
    const vT = P.VIRTUAL_TOKENS - t.tokensSold;
    let gross = (vH * tokensIn) / (vT + tokensIn);
    if (gross > t.realHYPE) gross = t.realHYPE;
    const fee = gross * (P.BOND_FEE + t.creatorTax);
    return { out: gross - fee, fee, gross };
  }

  private splitBondFee(t: Token, fee: number, isTax: boolean) {
    this.protocolAccrued += fee / 2;
    if (isTax) t.creatorLockedTax += fee / 4;
    else t.creatorClaimable += fee / 4;
    t.escrow += fee / 4;
  }

  failable(t: Token) {
    if (t.state !== "bonding") return false;
    return this.now >= t.createdAt + P.FAIL_AGE || this.now >= t.lastTradeAt + P.FAIL_IDLE;
  }

  /** Validates creator settings with the same bounds as ZephraLaunchpad.createAdvanced. */
  static checkLaunch(o: LaunchOptions) {
    const name = o.name.trim();
    const symbol = o.symbol.trim().toUpperCase();
    if (!name || name.length > 32) fail("Name must be 1–32 characters");
    if (!symbol || symbol.length > 10) fail("Ticker must be 1–10 characters");
    const tw = o.taxWindow ?? P.TAX_WINDOW;
    const st = o.startTax ?? P.TAX_START;
    const lc = o.levCap ?? 3;
    if (tw !== 0 && (tw < 30 || tw > 300)) fail("Anti-sniper window must be off or 30–300 seconds");
    if (tw !== 0 && (st < 0.1 || st > 1)) fail("Start tax must be 10–100%");
    if (![1, 2, 3].includes(lc)) fail("Perp leverage cap must be 1x, 2x or 3x");
    const ct = o.creatorTax ?? 0;
    if (!(ct >= 0 && ct <= 0.1)) fail("Creator tax must be between 0% and 10%");
    return { name, symbol, tw, st, lc, ct };
  }

  createToken(who: string, o: LaunchOptions): Token {
    const { name, symbol, tw, st, lc, ct } = Engine.checkLaunch(o);
    const devBuy = o.devBuy ?? 0;
    this.take(who, this.creationFee + devBuy);
    this.protocolAccrued += this.creationFee;
    const addr = "0x" + Math.floor(this.rand() * 2 ** 48).toString(16).padStart(12, "0") + (this.tokens.length + 1).toString(16).padStart(4, "0");
    const t: Token = {
      addr,
      name,
      symbol,
      description: o.description ?? "",
      hue: o.hue ?? Math.floor(this.rand() * 360),
      glyph: o.glyph ?? symbol.slice(0, 2),
      image: o.image || undefined,
      creator: who,
      createdAt: this.now,
      lastTradeAt: this.now,
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
      lastCumTime: this.now,
      obs: [{ t: this.now, cum: 0 }],
      supply: P.SUPPLY,
      gradTarget: this.G,
      virtualHYPE: (this.G * (P.VIRTUAL_TOKENS - P.CURVE_SUPPLY)) / P.CURVE_SUPPLY,
      taxWindow: tw,
      startTax: tw === 0 ? 0 : st,
      levCap: lc,
      creatorTax: ct,
      meta: { description: o.description, website: o.website, x: o.x, telegram: o.telegram },
      heat: 0.5,
    };
    this.tokens.unshift(t);
    if (devBuy > 0) {
      const q = this.quoteCurveBuy(t, devBuy, P.BOND_FEE);
      if (q.used < devBuy - 1e-9) fail("Dev buy too large");
      if (q.out > P.DEV_BUY_MAX) fail("Dev buy is capped at 10% of supply");
      t.realHYPE += q.used - q.fee;
      t.tokensSold += q.out;
      this.splitBondFee(t, q.fee, false);
      t.devLocked = q.out;
      this.addTrade(t, { who, kind: "dev buy", venue: "curve", hype: q.used, tokens: q.out, price: this.curvePrice(t) });
    }
    this.recordPrice(t);
    this.log(`${t.symbol} launched`, "info", t.addr);
    return t;
  }

  curveBuy(who: string, addr: string, hypeIn: number, minOut = 0) {
    const t = this.token(addr) ?? fail("Token not found");
    if (t.state !== "bonding") fail("Token is not on the bonding curve");
    if (this.failable(t)) fail("Token failed to graduate — curve is sell-only");
    if (hypeIn <= 0) fail("Amount must be greater than 0");
    const { rate, isTax } = this.buyFee(t);
    if (rate >= 1) fail("Tax is 100% — wait a few seconds");
    const q = this.quoteCurveBuy(t, hypeIn);
    if (q.out <= 0 || q.out < minOut) fail("Slippage exceeded");
    this.take(who, q.used);
    t.realHYPE += q.used - q.fee;
    t.tokensSold += q.out;
    this.splitBondFee(t, q.fee, isTax);
    t.holders[who] = (t.holders[who] ?? 0) + q.out;
    t.lastTradeAt = this.now;
    this.addTrade(t, { who, kind: "buy", venue: "curve", hype: q.used, tokens: q.out, price: this.curvePrice(t) });
    this.recordPrice(t);
    if (t.realHYPE >= t.gradTarget - 1e-9) this.graduate(t);
    return q;
  }

  curveSell(who: string, addr: string, tokensIn: number, minOut = 0) {
    const t = this.token(addr) ?? fail("Token not found");
    if (t.state !== "bonding" && t.state !== "failed") fail("Curve is closed");
    if (tokensIn <= 0) fail("Amount must be greater than 0");
    if ((t.holders[who] ?? 0) + 1e-6 < tokensIn) fail("Insufficient token balance");
    const q = this.quoteCurveSell(t, tokensIn);
    if (q.out < minOut) fail("Slippage exceeded");
    t.holders[who] -= tokensIn;
    t.realHYPE -= q.gross;
    t.tokensSold -= tokensIn;
    this.splitBondFee(t, q.fee, false);
    this.pay(who, q.out);
    t.lastTradeAt = this.now;
    this.addTrade(t, { who, kind: "sell", venue: "curve", hype: q.gross, tokens: tokensIn, price: this.curvePrice(t) });
    this.recordPrice(t);
    return q;
  }

  markFailed(addr: string) {
    const t = this.token(addr) ?? fail("Token not found");
    if (!this.failable(t)) fail("Failure conditions not met");
    t.state = "failed";
    t.creatorClaimable += t.creatorLockedTax + t.escrow;
    t.creatorLockedTax = 0;
    t.escrow = 0;
    this.log(`${t.symbol} failed to graduate — curve is sell-only`, "down", t.addr);
  }

  devVested(t: Token) {
    if (t.state === "failed") return t.devLocked;
    if (t.state !== "graduated") return 0;
    return t.devLocked * Math.min(1, (this.now - t.gradAt) / P.DEV_VEST);
  }

  /** Creator chooses where their earnings go (base engine: stored only). */
  setFeeSplits(who: string, addr: string, splits: { to: string; bps: number }[]) {
    const t = this.token(addr) ?? fail("Token not found");
    if (t.creator !== who) fail("Creator only");
    Engine.checkSplits(splits);
    t.splits = splits;
    this.emit();
    return splits;
  }

  static checkSplits(splits: { to: string; bps: number }[]) {
    if (splits.length > 5) fail("At most 5 recipients");
    if (splits.some((s) => !/^0x[0-9a-fA-F]{40}$/.test(s.to))) fail("Every recipient needs a valid 0x address");
    if (splits.some((s) => !(s.bps > 0))) fail("Every share must be above 0%");
    if (splits.length && splits.reduce((a, s) => a + s.bps, 0) !== 10_000) fail("Shares must add up to 100%");
  }

  claimCreator(who: string, addr: string) {
    const t = this.token(addr) ?? fail("Token not found");
    if (t.creator !== who) fail("Creator only");
    let amt = t.creatorClaimable;
    t.creatorClaimable = 0;
    if (t.pool) {
      amt += t.pool.creatorFees;
      t.pool.creatorFees = 0;
    }
    const dev = this.devVested(t) - t.devClaimed;
    if (dev > 0) {
      t.devClaimed += dev;
      t.holders[who] = (t.holders[who] ?? 0) + dev;
    }
    if (amt <= 0 && dev <= 0) fail("Nothing to claim yet");
    this.pay(who, amt);
    return { hype: amt, tokens: dev };
  }

  private graduate(t: Token) {
    const G = t.gradTarget;
    const poolHYPE = G * P.POOL_SHARE;
    const seed = G * P.SEED_SHARE;
    this.protocolAccrued += G - poolHYPE - seed;
    const vH = t.virtualHYPE + t.realHYPE;
    const vT = P.VIRTUAL_TOKENS - t.tokensSold;
    const poolTokens = (poolHYPE * vT) / vH;
    t.state = "graduated";
    t.gradAt = this.now;
    t.supply = P.CURVE_SUPPLY + poolTokens;
    if (t.heatAfter !== undefined) t.heat = t.heatAfter;
    t.realHYPE = G;
    t.pool = { rH: poolHYPE, rT: poolTokens, initialRH: poolHYPE, creatorFees: 0, protoFees: 0, vol: {} };
    const esc = t.escrow;
    t.escrow = 0;
    t.creatorClaimable += t.creatorLockedTax;
    t.creatorLockedTax = 0;
    t.market = {
      state: "warmup",
      gradAt: this.now,
      activeAt: this.now + P.WARMUP,
      closeOnlyAt: 0,
      settlementPrice: 0,
      vaultCash: seed + esc,
      totalShares: seed + esc,
      shares: { [TREASURY]: seed, [t.creator]: esc },
      locked: { [TREASURY]: seed, [t.creator]: esc },
      wreq: {},
      positions: [],
      long: { notional: 0, size: 0, sumSnap: 0 },
      short: { notional: 0, size: 0, sumSnap: 0 },
      idxL: 0,
      idxS: 0,
      lastAccrue: this.now,
      protoFees: 0,
      lastHeartbeat: this.now,
      graceUntil: 0,
      feesToVault: 0,
      navHist: [{ t: this.now, v: seed + esc }],
    };
    t.cum = 0;
    t.lastCumTime = this.now;
    t.obs = [{ t: this.now, cum: 0 }];
    this.recordPrice(t);
    this.log(`${t.symbol} graduated! Spot + perp markets created`, "up", t.addr);
  }

  // ==================================================================
  // Spot pool
  // ==================================================================

  quoteSpotBuy(t: Token, hypeIn: number) {
    const p = t.pool!;
    const fee = hypeIn * (P.SPOT_FEE + t.creatorTax);
    const net = hypeIn - fee;
    return { out: (p.rT * net) / (p.rH + net), fee };
  }

  quoteSpotSell(t: Token, tokensIn: number) {
    const p = t.pool!;
    const gross = (p.rH * tokensIn) / (p.rT + tokensIn);
    const fee = gross * (P.SPOT_FEE + t.creatorTax);
    return { out: gross - fee, fee, gross };
  }

  private recordVolume(t: Token, hype: number) {
    const h = Math.floor(this.now / 3600);
    t.pool!.vol[h] = (t.pool!.vol[h] ?? 0) + hype;
  }

  volume72h(t: Token) {
    if (!t.pool) return 0;
    const h = Math.floor(this.now / 3600);
    let v = 0;
    for (const [k, val] of Object.entries(t.pool.vol)) if (Number(k) + 72 > h) v += val;
    return v;
  }

  volume24h(t: Token) {
    const since = this.now - 86400;
    let v = 0;
    for (const tr of t.trades) {
      if (tr.t < since) break;
      if (tr.venue !== "vault") v += tr.hype;
    }
    return v;
  }

  change24h(t: Token) {
    const since = this.now - 86400;
    const h = t.priceHist;
    if (!h.length) return 0;
    let base = h[0].p;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= since) {
        base = h[i].p;
        break;
      }
    }
    return base > 0 ? this.price(t) / base - 1 : 0;
  }

  private distributeSpotFee(t: Token, fee: number) {
    const p = t.pool!;
    p.creatorFees += fee / 2;
    p.protoFees += fee / 8;
    const dev = fee / 4;
    const lp = fee / 8;
    const m = t.market!;
    const n = this.nav(t);
    const newSh = m.totalShares === 0 || n === 0 ? dev : (dev * m.totalShares) / n;
    m.shares[t.creator] = (m.shares[t.creator] ?? 0) + newSh;
    m.locked[t.creator] = (m.locked[t.creator] ?? 0) + newSh;
    m.totalShares += newSh;
    m.vaultCash += dev + lp;
    m.feesToVault += dev + lp;
  }

  spotBuy(who: string, addr: string, hypeIn: number, minOut = 0) {
    const t = this.token(addr) ?? fail("Token not found");
    if (!t.pool) fail("Spot market not live yet");
    if (hypeIn <= 0) fail("Amount must be greater than 0");
    this.updateOracle(t);
    const q = this.quoteSpotBuy(t, hypeIn);
    if (q.out < minOut) fail("Slippage exceeded");
    this.take(who, hypeIn);
    t.pool!.rH += hypeIn - q.fee;
    t.pool!.rT -= q.out;
    this.recordVolume(t, hypeIn);
    this.distributeSpotFee(t, q.fee);
    t.holders[who] = (t.holders[who] ?? 0) + q.out;
    this.addTrade(t, { who, kind: "buy", venue: "spot", hype: hypeIn, tokens: q.out, price: this.spot(t) });
    this.recordPrice(t);
    return q;
  }

  spotSell(who: string, addr: string, tokensIn: number, minOut = 0) {
    const t = this.token(addr) ?? fail("Token not found");
    if (!t.pool) fail("Spot market not live yet");
    if ((t.holders[who] ?? 0) + 1e-6 < tokensIn) fail("Insufficient token balance");
    if (tokensIn <= 0) fail("Amount must be greater than 0");
    this.updateOracle(t);
    const q = this.quoteSpotSell(t, tokensIn);
    if (q.out < minOut) fail("Slippage exceeded");
    t.holders[who] -= tokensIn;
    t.pool!.rT += tokensIn;
    t.pool!.rH -= q.gross;
    this.recordVolume(t, q.gross);
    this.distributeSpotFee(t, q.fee);
    this.pay(who, q.out);
    this.addTrade(t, { who, kind: "sell", venue: "spot", hype: q.gross, tokens: tokensIn, price: this.spot(t) });
    this.recordPrice(t);
    return q;
  }

  // ==================================================================
  // Perp market & vault
  // ==================================================================

  marketState(t: Token): MarketState | null {
    const m = t.market;
    if (!m) return null;
    if (m.state === "warmup" && this.now >= m.activeAt) return "active";
    return m.state;
  }

  maxLeverage(t: Token) {
    return Math.min(t.levCap, this.now < t.market!.activeAt + P.LOW_LEV_PERIOD ? 2 : 3);
  }

  private fundingCap(t: Token) {
    return Math.min(t.market!.vaultCash / 2, t.pool!.rH / 4);
  }

  fundingRate(t: Token) {
    const m = t.market!;
    const cap = this.fundingCap(t);
    if (cap <= 0) return 0;
    const r = (P.MAX_FUNDING_PER_SEC * (m.long.notional - m.short.notional)) / cap;
    return Math.max(-P.MAX_FUNDING_PER_SEC, Math.min(P.MAX_FUNDING_PER_SEC, r));
  }

  private pendingIdx(t: Token) {
    const m = t.market!;
    let iL = m.idxL;
    let iS = m.idxS;
    const dt = this.now - m.lastAccrue;
    if (dt <= 0 || m.state === "closed") return { iL, iS };
    const r = this.fundingRate(t);
    const d = r * dt;
    if (r > 0) {
      iL += d;
      if (m.short.notional > 0) iS -= (m.long.notional * d) / 2 / m.short.notional;
    } else if (r < 0) {
      iS -= d;
      if (m.long.notional > 0) iL -= (m.short.notional * -d) / 2 / m.long.notional;
    }
    return { iL, iS };
  }

  private accrue(t: Token) {
    const m = t.market!;
    const { iL, iS } = this.pendingIdx(t);
    m.idxL = iL;
    m.idxS = iS;
    m.lastAccrue = this.now;
    if (m.state === "warmup" && this.now >= m.activeAt) {
      m.state = "active";
      this.log(`${t.symbol} perp is live (2x for the first 24h)`, "up", t.addr);
    }
  }

  markPrice(t: Token) {
    const m = t.market!;
    if (m.state === "closed") return m.settlementPrice;
    return this.twap(t, P.TWAP_MARK);
  }

  nav(t: Token) {
    const m = t.market!;
    const { iL, iS } = this.pendingIdx(t);
    const p = this.markPrice(t);
    let v = m.vaultCash;
    v += m.long.notional * iL - m.long.sumSnap;
    v += m.short.notional * iS - m.short.sumSnap;
    const pnlL = Math.min(m.long.size * p - m.long.notional, m.long.notional * P.PROFIT_CAP);
    const pnlS = Math.min(m.short.notional - m.short.size * p, m.short.notional * P.PROFIT_CAP);
    v -= pnlL + pnlS;
    return Math.max(0, v);
  }

  capPerSide(t: Token) {
    return Math.min(this.nav(t) / 2, t.pool!.rH / 4);
  }

  reserved(t: Token) {
    const m = t.market!;
    return Math.max(m.long.notional, m.short.notional) * P.PROFIT_CAP;
  }

  freeLiquidity(t: Token) {
    const n = this.nav(t);
    const r = this.marketState(t) === "closed" ? 0 : this.reserved(t);
    return Math.min(Math.max(0, n - r), t.market!.vaultCash);
  }

  sharePrice(t: Token) {
    const m = t.market!;
    return m.totalShares > 0 ? this.nav(t) / m.totalShares : 1;
  }

  deviation(t: Token) {
    const s = this.spot(t);
    const tw = this.twap(t, P.TWAP_EXEC);
    return Math.abs(s - tw) / tw;
  }

  execPrice(t: Token, isLong: boolean, opening: boolean, notional: number) {
    const s = this.spot(t);
    const tw = this.twap(t, P.TWAP_EXEC);
    const cap = this.capPerSide(t);
    const impact = cap <= 0 ? P.MAX_IMPACT : Math.min(P.MAX_IMPACT, (P.MAX_IMPACT * notional) / cap);
    const high = isLong === opening;
    return high ? Math.max(s, tw) * (1 + impact) : Math.min(s, tw) * (1 - impact);
  }

  positionPnl(t: Token, ps: Position, p: number) {
    const value = ps.size * p;
    let pnl = ps.isLong ? value - ps.notional : ps.notional - value;
    pnl = Math.min(pnl, ps.notional * P.PROFIT_CAP);
    const { iL, iS } = this.pendingIdx(t);
    const idx = ps.isLong ? iL : iS;
    const owed = ps.notional * (idx - ps.fundSnap);
    return { pnl, owed };
  }

  equity(t: Token, ps: Position) {
    const { pnl, owed } = this.positionPnl(t, ps, this.markPrice(t));
    return ps.margin + pnl - owed - ps.notional * P.PERP_FEE;
  }

  liqPrice(ps: Position) {
    // mark price where equity = 10% of notional (ignores funding)
    const target = ps.notional * P.MAINT + ps.notional * P.PERP_FEE - ps.margin; // PnL that triggers liquidation
    // long: size*p - N = target -> p = (N + target)/size ; short: N - size*p = target
    return ps.isLong ? (ps.notional + target) / ps.size : (ps.notional - target) / ps.size;
  }

  getPosition(t: Token, who: string, isLong: boolean) {
    return t.market?.positions.find((p) => p.trader === who && p.isLong === isLong);
  }

  private heartbeat(t: Token) {
    const m = t.market!;
    if (this.now - m.lastHeartbeat > 60) {
      m.graceUntil = this.now + 600;
      this.log(`10-minute grace period on ${t.symbol} (sequencer was down)`, "info", t.addr);
    }
    m.lastHeartbeat = this.now;
  }

  openPosition(who: string, addr: string, isLong: boolean, notional: number, margin: number) {
    const t = this.token(addr) ?? fail("Token not found");
    const m = t.market ?? fail("Perp market not live yet");
    this.heartbeat(t);
    this.updateOracle(t);
    this.accrue(t);
    if (m.state !== "active") fail(m.state === "warmup" ? "Perp is still warming up" : "Market is not accepting new positions");
    if (this.now < m.graceUntil) fail("Grace period — new positions are paused");
    if (who === t.creator) fail("The creator (insider) cannot trade this token's perp");
    if (notional <= 0) fail("Size must be greater than 0");
    if (this.getPosition(t, who, isLong)) fail("You already have a position on this side");
    if (this.deviation(t) > P.MAX_DEV) fail("Spot/TWAP deviation above 3% — wait for the price to settle");
    const fee = notional * P.PERP_FEE;
    if (margin <= 0) fail("Margin must be greater than 0");
    if (notional > margin * this.maxLeverage(t) + 1e-9) fail(`Max leverage is ${this.maxLeverage(t)}x`);
    const cap = this.capPerSide(t);
    const side = isLong ? m.long : m.short;
    if (side.notional + notional > cap + 1e-9) fail("Open interest cap for this side is full");
    if (notional > cap * P.WALLET_CAP + 1e-9) fail("Exceeds the per-wallet limit (20% of cap)");
    const l = m.long.notional + (isLong ? notional : 0);
    const s = m.short.notional + (isLong ? 0 : notional);
    if (Math.max(l, s) * P.PROFIT_CAP > this.nav(t) * 0.8) fail("Market is reduce-only");
    this.take(who, margin + fee);
    const price = this.execPrice(t, isLong, true, notional);
    const size = notional / price;
    const idx = isLong ? m.idxL : m.idxS;
    m.protoFees += notional * P.PERP_FEE_PROTO;
    m.vaultCash += notional * P.PERP_FEE_VAULT;
    m.feesToVault += notional * P.PERP_FEE_VAULT;
    side.notional += notional;
    side.size += size;
    side.sumSnap += notional * idx;
    m.positions.push({ trader: who, isLong, margin, notional, size, entry: price, fundSnap: idx, openedAt: this.now });
    this.addTrade(t, { who, kind: isLong ? "long" : "short", venue: "perp", hype: notional, tokens: size, price });
    return { price, size, fee };
  }

  addMargin(who: string, addr: string, isLong: boolean, amt: number) {
    const t = this.token(addr) ?? fail("Token not found");
    const ps = this.getPosition(t, who, isLong) ?? fail("No open position");
    this.take(who, amt);
    ps.margin += amt;
  }

  private removePosition(t: Token, ps: Position) {
    const m = t.market!;
    const side = ps.isLong ? m.long : m.short;
    side.notional -= ps.notional;
    side.size -= ps.size;
    side.sumSnap -= ps.notional * ps.fundSnap;
    m.positions = m.positions.filter((x) => x !== ps);
  }

  private settleClose(t: Token, ps: Position, p: number, withFee: boolean, kind: string) {
    const m = t.market!;
    const { pnl, owed } = this.positionPnl(t, ps, p);
    const equity = ps.margin + pnl - owed;
    const fee = withFee ? ps.notional * P.PERP_FEE : 0;
    let protoFee = 0;
    if (withFee && equity > 0) protoFee = Math.min(ps.notional * P.PERP_FEE_PROTO, equity);
    let payout = Math.max(0, equity - fee);
    this.removePosition(t, ps);
    m.protoFees += protoFee;
    const delta = ps.margin - payout - protoFee;
    if (delta >= 0) {
      m.vaultCash += delta;
      if (withFee) m.feesToVault += fee - protoFee;
    } else {
      let need = -delta;
      if (need > m.vaultCash) {
        payout -= need - m.vaultCash;
        need = m.vaultCash;
        if (m.state === "active") {
          m.state = "closeonly";
          m.closeOnlyAt = this.now;
        }
      }
      m.vaultCash -= need;
    }
    this.pay(ps.trader, payout);
    this.addTrade(t, { who: ps.trader, kind, venue: "perp", hype: ps.notional, tokens: ps.size, price: p });
    return { pnl, payout };
  }

  closePosition(who: string, addr: string, isLong: boolean) {
    const t = this.token(addr) ?? fail("Token not found");
    const ps = this.getPosition(t, who, isLong) ?? fail("No open position");
    this.heartbeat(t);
    this.updateOracle(t);
    this.accrue(t);
    if (t.market!.state === "closed") return this.settleClose(t, ps, t.market!.settlementPrice, false, "settle");
    const p = this.execPrice(t, isLong, false, ps.notional);
    return this.settleClose(t, ps, p, true, "close");
  }

  atProfitCap(t: Token, ps: Position) {
    const p = this.execPrice(t, ps.isLong, false, ps.notional);
    const value = ps.size * p;
    const raw = ps.isLong ? value - ps.notional : ps.notional - value;
    return raw >= ps.notional * P.PROFIT_CAP;
  }

  isLiquidatable(t: Token, ps: Position) {
    return this.equity(t, ps) < ps.notional * P.MAINT;
  }

  private liquidate(t: Token, ps: Position, liquidator: string) {
    const m = t.market!;
    const eq = this.equity(t, ps);
    const reward = Math.min(Math.max(0, eq), ps.notional * P.LIQ_REWARD);
    this.removePosition(t, ps);
    m.vaultCash += ps.margin - reward;
    this.pay(liquidator, reward);
    this.addTrade(t, { who: ps.trader, kind: "liquidated", venue: "perp", hype: ps.notional, tokens: ps.size, price: this.markPrice(t) });
    if (ps.trader === YOU) this.log(`Your ${t.symbol} ${ps.isLong ? "long" : "short"} was liquidated`, "down", t.addr);
  }

  // ---------------- vault ----------------

  availableShares(t: Token, who: string) {
    const m = t.market!;
    const locked = this.marketState(t) === "closed" ? 0 : m.locked[who] ?? 0;
    const used = locked + (m.wreq[who]?.shares ?? 0);
    return Math.max(0, (m.shares[who] ?? 0) - used);
  }

  deposit(who: string, addr: string, amt: number) {
    const t = this.token(addr) ?? fail("Token not found");
    const m = t.market ?? fail("Vault not live yet");
    this.accrue(t);
    if (m.state !== "warmup" && m.state !== "active") fail("Deposits are closed");
    if (amt <= 0) fail("Amount must be greater than 0");
    const n = this.nav(t);
    if (n + amt > t.gradTarget * P.GUARD_NAV_MULT) fail(`Guarded launch: vault NAV is capped at ${t.gradTarget * P.GUARD_NAV_MULT} HYPE`);
    this.take(who, amt);
    const sh = m.totalShares === 0 || n === 0 ? amt : (amt * m.totalShares) / n;
    m.shares[who] = (m.shares[who] ?? 0) + sh;
    m.totalShares += sh;
    m.vaultCash += amt;
    this.addTrade(t, { who, kind: "deposit", venue: "vault", hype: amt, tokens: sh, price: this.sharePrice(t) });
    return sh;
  }

  requestWithdraw(who: string, addr: string, sh: number) {
    const t = this.token(addr) ?? fail("Token not found");
    const m = t.market ?? fail("Vault not live yet");
    if (sh <= 0 || sh > this.availableShares(t, who) + 1e-9) fail("Not enough withdrawable shares (locked shares cannot be withdrawn)");
    const w = m.wreq[who] ?? { shares: 0, readyAt: 0 };
    w.shares += sh;
    w.readyAt = this.marketState(t) === "closed" ? this.now : this.now + P.LP_COOLDOWN;
    m.wreq[who] = w;
  }

  cancelWithdraw(who: string, addr: string) {
    const t = this.token(addr) ?? fail("Token not found");
    delete t.market!.wreq[who];
  }

  withdrawStatus(t: Token, who: string): { ready: boolean; reason: string } {
    const m = t.market!;
    const w = m.wreq[who];
    if (!w) return { ready: false, reason: "" };
    if (this.now < w.readyAt) return { ready: false, reason: "1-hour cooldown in progress" };
    if (m.state === "closed" && m.positions.length > 0) return { ready: false, reason: "Waiting for all positions to settle" };
    if (this.freeLiquidity(t) <= 1e-9) return { ready: false, reason: "Liquidity reserved for open positions — queued" };
    return { ready: true, reason: "Ready — keeper will execute" };
  }

  executeWithdraw(who: string, addr: string) {
    const t = this.token(addr) ?? fail("Token not found");
    const m = t.market!;
    this.accrue(t);
    const w = m.wreq[who] ?? fail("No withdrawal request");
    const st = this.withdrawStatus(t, who);
    if (!st.ready) fail(st.reason);
    const n = this.nav(t);
    let amt = (w.shares * n) / m.totalShares;
    const free = this.freeLiquidity(t);
    let burn = w.shares;
    if (amt > free) {
      burn = (w.shares * free) / amt;
      amt = free;
    }
    w.shares -= burn;
    m.shares[who] -= burn;
    m.totalShares -= burn;
    if ((m.locked[who] ?? 0) > m.shares[who]) m.locked[who] = m.shares[who];
    m.vaultCash -= amt;
    if (w.shares <= 1e-12) delete m.wreq[who];
    this.pay(who, amt);
    this.addTrade(t, { who, kind: "withdraw", venue: "vault", hype: amt, tokens: burn, price: this.sharePrice(t) });
    if (who === YOU) this.log(`${t.symbol} vault withdrawal: ${amt.toFixed(2)} HYPE sent`, "up", t.addr);
    return amt;
  }

  // ---------------- status ----------------

  private isWeak(t: Token) {
    const m = t.market!;
    const thin = t.pool!.rH < t.pool!.initialRH * 0.3;
    const low = this.now >= m.activeAt + P.CLOSE_ONLY_PERIOD && this.volume72h(t) < t.gradTarget / 100;
    return thin || low;
  }

  checkStatus(t: Token) {
    const m = t.market!;
    this.accrue(t);
    const weak = this.isWeak(t);
    if (m.state === "active" && weak) {
      m.state = "closeonly";
      m.closeOnlyAt = this.now;
      this.log(`${t.symbol} moved to close-only (inactive market)`, "down", t.addr);
    } else if (m.state === "closeonly") {
      if (!weak) {
        m.state = "active";
        this.log(`${t.symbol} is active again`, "up", t.addr);
      } else if (this.now >= m.closeOnlyAt + P.CLOSE_ONLY_PERIOD) {
        m.settlementPrice = this.twap(t, P.TWAP_SETTLE);
        m.state = "closed";
        this.log(`${t.symbol} closed — settled at the 1-hour TWAP`, "info", t.addr);
      }
    }
  }

  // ==================================================================
  // Time, keeper and bots
  // ==================================================================

  /** Advance time. The keeper (heartbeat, liquidations, withdrawals, status) and bots run every step. */
  advance(sec: number, opts: { bots?: boolean; step?: number } = {}) {
    const bots = opts.bots ?? true;
    const stepMax = opts.step ?? 10;
    let left = sec;
    while (left > 0) {
      const step = Math.min(stepMax, left);
      this.now += step;
      left -= step;
      for (const t of this.tokens) {
        if (bots) this.botStep(t, step);
        this.keeperStep(t);
      }
    }
  }

  /** Simulate a sequencer outage: time jumps with no heartbeat. */
  simulateOutage(sec: number) {
    this.now += sec;
    for (const t of this.tokens) if (t.market) this.heartbeat(t);
    this.log(`Simulated sequencer outage: ${Math.round(sec / 60)} min`, "info");
  }

  private keeperStep(t: Token) {
    if (t.state === "bonding" && this.failable(t)) this.markFailed(t.addr);
    if (t.state !== "graduated") return;
    const m = t.market!;
    this.heartbeat(t);
    this.updateOracle(t);
    this.accrue(t);
    if (m.state !== "closed") {
      if (this.now >= m.graceUntil) {
        for (const ps of [...m.positions]) {
          if (this.isLiquidatable(t, ps)) this.liquidate(t, ps, "0xKeeper");
        }
      }
      for (const ps of [...m.positions]) {
        if (m.positions.includes(ps) && this.atProfitCap(t, ps)) {
          this.settleClose(t, ps, this.execPrice(t, ps.isLong, false, ps.notional), true, "profit cap");
          if (ps.trader === YOU) this.log(`Your ${t.symbol} position was auto-closed at the profit cap`, "up", t.addr);
        }
      }
    } else {
      for (const ps of [...m.positions]) this.settleClose(t, ps, m.settlementPrice, false, "settle");
    }
    for (const who of Object.keys(m.wreq)) {
      if (this.withdrawStatus(t, who).ready) {
        try {
          this.executeWithdraw(who, t.addr);
        } catch {
          /* queued */
        }
      }
    }
    if (Math.floor(this.now / 60) !== Math.floor((this.now - 10) / 60)) this.checkStatus(t);
    const last = m.navHist[m.navHist.length - 1];
    if (!last || this.now - last.t >= 300) {
      m.navHist.push({ t: this.now, v: this.nav(t) });
      if (m.navHist.length > 2000) m.navHist.shift();
    }
  }

  private botName() {
    const n = ["0xA1ce", "0xB0b", "0xC4rl", "0xD4n", "0xE7h", "0xF3y", "0x9un", "0x7ia", "0x5am", "0x3ve", "0x2ox", "0x8ek"];
    return n[Math.floor(this.rand() * n.length)];
  }

  private botStep(t: Token, step: number) {
    const r = this.rand;
    const k = step / 10;
    if (t.state === "bonding") {
      if (this.now - t.createdAt < 50) return; // bots wait for the tax to decay
      const lam = 0.22 * t.heat * k;
      const n = Math.floor(lam) + (r() < lam % 1 ? 1 : 0);
      for (let i = 0; i < n && t.state === "bonding"; i++) {
        const who = this.botName();
        try {
          if (r() < 0.5 + 0.38 * t.heat) {
            this.balances[who] = 1e9;
            this.curveBuy(who, t.addr, 0.5 + r() * r() * 30 * t.heat);
          } else if ((t.holders[who] ?? 0) > 0) {
            this.curveSell(who, t.addr, (t.holders[who] ?? 0) * (0.1 + r() * 0.4));
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (t.state !== "graduated") return;
    const m = t.market!;
    const lam = 0.25 * t.heat * k;
    const n = Math.floor(lam) + (r() < lam % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const who = this.botName();
      this.balances[who] = 1e9;
      try {
        const roll = r();
        if (roll < 0.6) {
          // random walk with a small drift based on heat
          const bias = 0.47 + (t.heat - 0.5) * 0.08;
          if (r() < bias) this.spotBuy(who, t.addr, 0.3 + r() * r() * 9 * t.heat);
          else {
            // sell the same HYPE size as buys (symmetric random walk)
            const want = (0.3 + r() * r() * 9 * t.heat) / this.spot(t);
            const have = t.holders[who] ?? 0;
            if (have < want) t.holders[who] = want; // bots hold inventory from the bonding phase
            this.spotSell(who, t.addr, want);
          }
        } else if (roll < 0.85 && this.marketState(t) === "active") {
          const isLong = r() < 0.55;
          const existing = this.getPosition(t, who, isLong);
          if (existing) this.closePosition(who, t.addr, isLong);
          else {
            const cap = this.capPerSide(t);
            const lev = 1 + r() * (this.maxLeverage(t) - 1);
            const notional = Math.max(0.2, cap * (0.02 + r() * 0.12));
            this.openPosition(who, t.addr, isLong, notional, notional / lev);
          }
        } else if (roll < 0.93 && this.marketState(t) === "active") {
          this.deposit(who, t.addr, 2 + r() * 25);
        } else {
          const avail = m.shares[who] ? this.availableShares(t, who) : 0;
          if (avail > 0) this.requestWithdraw(who, t.addr, avail * (0.3 + r() * 0.7));
        }
      } catch {
        /* ignore */
      }
    }
  }

  // ==================================================================
  // Stats
  // ==================================================================

  stats() {
    let vol = 0;
    let tvl = 0;
    let grads = 0;
    let oi = 0;
    for (const t of this.tokens) {
      vol += this.volume24h(t);
      if (t.state === "graduated") {
        grads++;
        tvl += this.nav(t) + t.pool!.rH;
        oi += t.market!.long.notional + t.market!.short.notional;
      } else tvl += t.realHYPE;
    }
    return { vol, tvl, grads, oi, launched: this.tokens.length };
  }
}
