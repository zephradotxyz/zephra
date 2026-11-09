import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Copy, Timer, ShieldAlert, Lock, Info, TrendingUp, TrendingDown, Plus, Globe, AtSign, Send, ExternalLink, HeartPulse, Wallet, Check, Link as LinkIcon, Share2 } from "lucide-react";
import { useEngine, act } from "../store";
import { YOU, type Engine, type Token, type Position } from "../engine/engine";
import { P } from "../engine/params";
import PriceChart from "../components/PriceChart";
import TokenSafety from "../components/TokenSafety";
import { Reveal, TokenIcon, StatusBadge, Progress, Tabs, SegTabs, Row, Pct, Empty } from "../components/ui";
import hypeLogo from "../assets/hype.png";
import fomoLogo from "../assets/fomo.png";
import gmgnLogo from "../assets/gmgn.png";
import { useHypeUsd, usd } from "../lib/usd";
import { fmt, fmtPrice, ago, dur, short, pct, sPct } from "../lib/format";
import { getChain } from "../store";
import { addrUrl } from "../chain/config";
import { SITE } from "../site";

export default function TokenPage() {
  const { addr } = useParams();
  const e = useEngine();
  const t = e.token(addr ?? "");
  if (!t)
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-24 text-center text-muted">
        Token not found. <Link to="/" className="text-accent">Go back</Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-5 md:px-8 md:pt-6">
      <Link to="/trade" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent">
        <ArrowLeft size={15} /> Explore
      </Link>
      <Header e={e} t={t} />
      <div className="mt-4 grid grid-cols-1 gap-4 md:mt-5 md:gap-5 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <Reveal y={16}><PriceChart e={e} t={t} /></Reveal>
          {/* On mobile/tablet the trade panel sits right under the chart */}
          <div className="xl:hidden"><TradePanel e={e} t={t} /></div>
          {t.state === "bonding" && <Reveal y={16}><CurveCard e={e} t={t} /></Reveal>}
          {t.market && <Reveal y={16}><MarketStats e={e} t={t} /></Reveal>}
          <Reveal y={16}><BottomTabs e={e} t={t} /></Reveal>
          <Reveal y={16}><PerpRules e={e} t={t} /></Reveal>
        </div>
        <div className="flex flex-col gap-4 md:gap-5">
          <Reveal y={16} delay={0.05} className="hidden xl:block"><TradePanel e={e} t={t} /></Reveal>
          {t.market && <Reveal y={16} delay={0.1}><VaultPanel e={e} t={t} /></Reveal>}
          {t.creator === YOU && <Reveal y={16}><CreatorPanel e={e} t={t} /></Reveal>}
          <Reveal y={16} delay={0.1}><WhereItTrades e={e} t={t} /></Reveal>
          <Reveal y={16} delay={0.12}><AboutCard e={e} t={t} /></Reveal>
          <Reveal y={16} delay={0.14}><TokenSafety t={t} /></Reveal>
        </div>
      </div>
    </div>
  );
}

const FOMO_CHAIN = "elysium";

/** Copy text; falls back to a hidden textarea where the Clipboard API is blocked (preview iframes, http). */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

function Header({ e, t }: { e: Engine; t: Token }) {
  const r = useHypeUsd();
  const [copied, setCopied] = useState<"" | "ca" | "link">("");
  const mcap = e.marketCap(t);
  const holders = Object.values(t.holders).filter((v) => v > 1).length;
  const feeRate = (t.state === "graduated" ? P.SPOT_FEE : P.BOND_FEE) + t.creatorTax;
  const liquidity = t.pool ? t.pool.rH * 2 : t.realHYPE;
  const shareUrl = `https://${SITE.domain}/token/${t.addr}`;
  const fomoUrl = `https://fomo.family/tokens/${FOMO_CHAIN}/${t.addr.toLowerCase()}`;
  const gmgnUrl = `https://gmgn.ai/${FOMO_CHAIN}/token/${t.addr}`;
  const copy = async (k: "ca" | "link", text: string) => { if (await copyText(text)) flash(k); };
  const flash = (k: "ca" | "link") => { setCopied(k); setTimeout(() => setCopied(""), 1500); };
  const priceHype = e.price(t);
  const stats: [string, string, string][] = [
    ["Price", usd(priceHype, r, 6), `${fmtPrice(priceHype)} HYPE`],
    ["Market cap", usd(mcap, r), ""],
    ["24h volume", usd(e.volume24h(t), r), ""],
    ["Holders", String(holders), ""],
    ["Fee", pct(feeRate, 1), t.creatorTax > 0 ? `incl. ${pct(t.creatorTax, 1)} creator tax` : ""],
    ["Liquidity", usd(liquidity, r), t.pool ? "locked in pool" : "raised on curve"],
  ];
  const iconBtn = "grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-white/5 hover:text-accent";
  return (
    <Reveal y={12}>
      <div className="card p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <TokenIcon t={t} size={80} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="truncate text-3xl font-extrabold tracking-tight md:text-5xl">{t.name}</h1>
              <span className="text-base font-semibold text-muted md:text-lg">{t.symbol}</span>
              <StatusBadge e={e} t={t} />
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-line2 bg-panel2 px-3 py-1.5 text-xs font-bold" title="Trading fees on this token are paid to the creator's chosen wallets">
                <Wallet size={13} /> Pays creator
              </span>
              {t.creatorTax > 0 && <span className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent">{pct(t.creatorTax, 1)} tax</span>}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line2 px-2 py-1 font-semibold text-ink"><img src={hypeLogo} alt="" className="h-4 w-4 rounded-full" />HYPE</span>
              <button onClick={() => void copy("ca", t.addr)} className="flex items-center gap-1.5 rounded-lg border border-line2 px-2 py-1 font-mono hover:text-accent" title="Copy contract address">
                {copied === "ca" ? "Copied" : short(t.addr)} <Copy size={11} />
              </button>
              {t.createdAt > 0 && <span>{ago(e.now - t.createdAt)}</span>}
              {t.creator && <span>creator {t.creator === YOU ? "you" : short(t.creator)}</span>}
              <span className="flex items-center gap-0.5">
                <a href={fomoUrl} target="_blank" rel="noreferrer" className={iconBtn} title="Open on fomo" aria-label="Open on fomo"><img src={fomoLogo} alt="" className="h-[18px] w-[18px] rounded" /></a>
                <a href={gmgnUrl} target="_blank" rel="noreferrer" className={iconBtn} title="Open on GMGN" aria-label="Open on GMGN"><img src={gmgnLogo} alt="" className="h-[18px] w-[18px] rounded" /></a>
                <button onClick={() => void copy("link", shareUrl)} className={iconBtn} title={`Copy Zephra link: ${shareUrl}`} aria-label="Copy Zephra link">{copied === "link" ? <Check size={15} className="text-accent" /> : <LinkIcon size={15} />}</button>
                <a href={`https://x.com/intent/post?text=${encodeURIComponent(`${t.name} ($${t.symbol}) on Zephra`)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" className={iconBtn} title="Share on X" aria-label="Share on X"><Share2 size={15} /></a>
              </span>
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([k, v, sub]) => (
            <div key={k} className="bg-panel px-4 py-3">
              <div className="text-xs text-muted">{k}</div>
              <div className="num mt-0.5 whitespace-nowrap text-xl font-bold">{v}</div>
              {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function WhereItTrades({ e, t }: { e: Engine; t: Token }) {
  const r = useHypeUsd();
  const extra = (t as Token & { chain?: { pool?: string; market?: string } }).chain;
  const fee = t.state === "graduated" ? P.SPOT_FEE : P.BOND_FEE;
  return (
    <div className="card p-5">
      <h3 className="mb-3 font-bold">Where it trades</h3>
      <div className="space-y-2">
        <Row k="Market" v={t.state === "graduated" ? "Spot pool + perps" : t.state === "failed" ? "Closed (refunds)" : "Bonding curve"} />
        <Row k="Paired with" v="HYPE" />
        <Row k="Trading fee" v={pct(fee, 1)} />
        {t.creatorTax > 0 && <Row k="Creator tax" v={`${pct(t.creatorTax, 1)} on every buy and sell`} />}
        <Row k="Fee goes to" v="the creator and the protocol" />
        {!t.pool && <Row k="Raised" v={`${usd(t.realHYPE, r)} / ${usd(t.gradTarget, r, 0)}`} />}
        {extra?.pool && <Row k="Pool" v={short(extra.pool)} />}
        {extra?.market && <Row k="Perp market" v={short(extra.market)} />}
        <Row k="Creator" v={t.creator === YOU ? "you" : short(t.creator)} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Trade panel
// ----------------------------------------------------------------------

function TradePanel({ e, t }: { e: Engine; t: Token }) {
  const [tab, setTab] = useState<"spot" | "perp">("perp");
  if (t.state !== "graduated") return <CurveTrade e={e} t={t} />;
  return (
    <div className="card p-5">
      <Tabs value={tab} onChange={setTab} className="mb-4" items={[{ id: "perp", label: "Perp" }, { id: "spot", label: "Spot" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(6px)" }} transition={{ duration: 0.25 }}>
          {tab === "spot" ? <SpotTrade e={e} t={t} /> : <PerpTrade e={e} t={t} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AmountInput({ value, onChange, unit, max, presets }: { value: string; onChange: (v: string) => void; unit: string; max?: number; presets?: number[] }) {
  return (
    <div>
      <div className="relative">
        <input className="input num pr-20 text-lg" inputMode="decimal" placeholder="0.0" value={value} onChange={(ev) => onChange(ev.target.value.replace(/[^0-9.]/g, ""))} />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">{unit}</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {(presets ?? []).map((p) => (
          <button key={p} onClick={() => onChange(String(p))} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-muted hover:text-ink">{fmt(p, p < 10 ? 1 : 0)}</button>
        ))}
        {max !== undefined && (
          <button onClick={() => onChange(String(Math.floor(max * 1e6) / 1e6))} className="ml-auto rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent hover:bg-accent/20">MAX</button>
        )}
      </div>
    </div>
  );
}

function CurveTrade({ e, t }: { e: Engine; t: Token }) {
  const failed = t.state === "failed";
  const [side, setSide] = useState<"buy" | "sell">(failed ? "sell" : "buy");
  const [amt, setAmt] = useState("");
  const a = Number(amt) || 0;
  const fee = e.buyFee(t);
  const held = t.holders[YOU] ?? 0;
  const taxLeft = t.taxWindow - (e.now - t.createdAt);
  const q = side === "buy" ? (a > 0 ? e.quoteCurveBuy(t, a) : null) : a > 0 ? e.quoteCurveSell(t, Math.min(a, held)) : null;

  const submit = () => {
    if (side === "buy") act(() => e.curveBuy(YOU, t.addr, a, ((q as { out: number })?.out ?? 0) * 0.98), (r) => `Bought ${fmt(r.out)} ${t.symbol}`);
    else act(() => e.curveSell(YOU, t.addr, a, ((q as { out: number })?.out ?? 0) * 0.98), (r) => `Sold for ${fmt(r.out)} HYPE`);
    setAmt("");
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">{failed ? "Curve sell-only" : "Bonding curve"}</h3>
        {!failed && fee.isTax && (
          <span className="flex items-center gap-1.5 rounded-full bg-warn/10 px-2.5 py-1 text-[11px] font-bold text-warn">
            <Timer size={12} /> Tax {(fee.rate * 100).toFixed(0)}% · {dur(taxLeft)}
          </span>
        )}
      </div>
      {!failed && <SegTabs value={side} onChange={(v) => { setSide(v); setAmt(""); }} items={[{ id: "buy", label: "Buy" }, { id: "sell", label: "Sell", tone: "down" }]} />}
      <div className="mt-4">
        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          <span className="num">Balance: {side === "buy" ? `${fmt(e.bal(YOU))} HYPE` : `${fmt(held)} ${t.symbol}`}</span>
        </div>
        <AmountInput value={amt} onChange={setAmt} unit={side === "buy" ? "HYPE" : t.symbol} max={side === "buy" ? e.bal(YOU) : held} presets={side === "buy" ? [1, 5, 25, 100] : undefined} />
      </div>
      <div className="mt-4 space-y-2 rounded-2xl bg-bg/60 p-4">
        {side === "buy" ? (
          <>
            <Row k="You receive" v={q ? `${fmt((q as { out: number }).out)} ${t.symbol}` : "—"} />
            <Row k={fee.isTax ? "Anti-sniper tax" : "Bonding fee"} v={`${(fee.rate * 100).toFixed(1)}%${q ? ` · ${fmt((q as { fee: number }).fee, 3)} HYPE` : ""}`} />
            {q && (q as { used: number }).used < a - 1e-9 && <Row k="Refunded (curve full)" v={`${fmt(a - (q as { used: number }).used, 3)} HYPE`} />}
          </>
        ) : (
          <>
            <Row k="You receive" v={q ? `${fmt((q as { out: number }).out, 4)} HYPE` : "—"} />
            <Row k="Fee" v="1%" />
          </>
        )}
        <Row k="Pool price" v={fmtPrice(e.curvePrice(t))} />
        <Row k="Max slippage" v="2%" />
      </div>
      <button onClick={submit} disabled={a <= 0 || (side === "buy" && fee.rate >= 1)} className={`btn mt-4 h-12 w-full ${side === "buy" ? "btn-accent" : "bg-down text-[#1a0307]"}`}>
        {side === "buy" ? `Buy ${t.symbol}` : `Sell ${t.symbol}`}
      </button>
      {fee.isTax && !failed && <p className="mt-3 text-xs leading-relaxed text-warn/80">The tax decays linearly from 100% to 2% over the first 60 seconds. Wait a moment if you are not in a hurry.</p>}
      {failed && <p className="mt-3 text-xs text-muted">This token failed to graduate. Your HYPE is still in the curve and you can withdraw it at any time by selling.</p>}
    </div>
  );
}

function SpotTrade({ e, t }: { e: Engine; t: Token }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const a = Number(amt) || 0;
  const held = t.holders[YOU] ?? 0;
  const q = a > 0 ? (side === "buy" ? e.quoteSpotBuy(t, a) : e.quoteSpotSell(t, Math.min(a, held))) : null;
  const sp = e.spot(t);
  const impact = q && sp > 0 ? Math.abs(side === "buy" ? (a - q.fee) / q.out / sp - 1 : 1 - (q as unknown as { gross: number }).gross / Math.min(a, held) / sp) : 0;
  const submit = () => {
    if (side === "buy") act(() => e.spotBuy(YOU, t.addr, a, (q?.out ?? 0) * 0.98), (r) => `Bought ${fmt(r.out)} ${t.symbol}`);
    else act(() => e.spotSell(YOU, t.addr, a, (q?.out ?? 0) * 0.98), (r) => `Sold for ${fmt(r.out)} HYPE`);
    setAmt("");
  };
  return (
    <div>
      <SegTabs value={side} onChange={(v) => { setSide(v); setAmt(""); }} items={[{ id: "buy", label: "Buy" }, { id: "sell", label: "Sell", tone: "down" }]} />
      <div className="mt-4">
        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          <span className="num">Balance: {side === "buy" ? `${fmt(e.bal(YOU))} HYPE` : `${fmt(held)} ${t.symbol}`}</span>
        </div>
        <AmountInput value={amt} onChange={setAmt} unit={side === "buy" ? "HYPE" : t.symbol} max={side === "buy" ? e.bal(YOU) : held} presets={side === "buy" ? [1, 10, 50] : undefined} />
      </div>
      <div className="mt-4 space-y-2 rounded-2xl bg-bg/60 p-4">
        <Row k="You receive" v={q ? (side === "buy" ? `${fmt(q.out)} ${t.symbol}` : `${fmt(q.out, 4)} HYPE`) : "—"} />
        <Row k="Fee 2%" v={q ? `${fmt(q.fee, 4)} HYPE` : "creator 0.75% · vault 0.75% · Zephra 0.5%"} />
        <Row k="Price impact" v={<span className={impact > 0.03 ? "text-warn" : ""}>{pct(impact)}</span>} />
        <Row k="Max slippage" v="2%" />
      </div>
      <button onClick={submit} disabled={a <= 0} className={`btn mt-4 h-12 w-full ${side === "buy" ? "btn-accent" : "bg-down text-[#1a0307]"}`}>
        {side === "buy" ? `Buy ${t.symbol}` : `Sell ${t.symbol}`}
      </button>
    </div>
  );
}

function PerpTrade({ e, t }: { e: Engine; t: Token }) {
  const m = t.market!;
  const ms = e.marketState(t)!;
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("");
  const maxLev = e.maxLeverage(t);
  const [lev, setLev] = useState(2);
  const L = Math.min(lev, maxLev);
  const isLong = side === "long";
  const mg = Number(margin) || 0;
  const notional = mg * L;
  const cap = e.capPerSide(t);
  const sideNotional = isLong ? m.long.notional : m.short.notional;
  const room = Math.max(0, Math.min(cap - sideNotional, cap * P.WALLET_CAP));
  const entry = e.execPrice(t, isLong, true, notional || 1e-9);
  const fee = notional * P.PERP_FEE;
  const est: Position | null = notional > 0 ? { trader: YOU, isLong, margin: mg, notional, size: notional / entry, entry, fundSnap: 0, openedAt: 0 } : null;
  const liq = est ? e.liqPrice(est) : 0;
  const dev = e.deviation(t);
  const fr = e.fundingRate(t) * 3600;
  const insider = t.creator === YOU;
  const inGrace = e.now < m.graceUntil;
  const existing = e.getPosition(t, YOU, isLong);
  const chain = getChain();

  let block = "";
  if (ms === "warmup") block = `Warm-up — perps open in ${dur(m.activeAt - e.now)}`;
  else if (ms === "closeonly") block = "Close-only — you can only close positions";
  else if (ms === "closed") block = "Market closed — positions are being settled";
  else if (inGrace) block = `Grace period ${dur(m.graceUntil - e.now)} — new positions paused`;
  else if (chain?.heartbeatStale(t)) block = "Market heartbeat is stale (no keeper for over 60s). Opening now would start a 10-minute grace period. Poke the market below to refresh it.";
  else if (insider) block = "You created this token (insider) — you cannot trade its perp";
  else if (dev > P.MAX_DEV) block = `Spot vs TWAP deviation ${pct(dev)} is above 3% — wait for it to settle`;
  else if (existing) block = `You already have a ${side} — close it below first`;

  const submit = () => {
    act(() => e.openPosition(YOU, t.addr, isLong, notional, mg), (r) => `${isLong ? "Long" : "Short"} ${fmt(notional)} HYPE opened @ ${fmtPrice(r.price)}`);
    setMargin("");
  };

  return (
    <div>
      <SegTabs value={side} onChange={setSide} items={[{ id: "long", label: <span className="flex items-center justify-center gap-1.5"><TrendingUp size={14} />Long</span> }, { id: "short", label: <span className="flex items-center justify-center gap-1.5"><TrendingDown size={14} />Short</span>, tone: "down" }]} />
      <div className="mt-4">
        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>Margin</span>
          <span className="num">Balance: {fmt(e.bal(YOU))} HYPE</span>
        </div>
        <AmountInput value={margin} onChange={setMargin} unit="HYPE" presets={[1, 5, 10]} max={Math.min(e.bal(YOU) / (1 + L * P.PERP_FEE), room / L)} />
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted">Leverage</span>
          <span className="num rounded-lg bg-accent/10 px-2 py-0.5 font-bold text-accent">{L.toFixed(1)}x</span>
        </div>
        <input type="range" className="zr w-full" min={1} max={maxLev} step={0.1} value={L} onChange={(ev) => setLev(Number(ev.target.value))} style={{ ["--p" as string]: `${((L - 1) / (maxLev - 1)) * 100}%` }} />
        <div className="mt-1.5 flex justify-between text-[11px] text-faint">
          <span>1x</span>
          <span>{maxLev}x {maxLev === 2 && <span className="text-warn">(first 24h)</span>}</span>
        </div>
      </div>
      <div className="mt-4 space-y-2 rounded-2xl bg-bg/60 p-4">
        <Row k="Position size" v={`${fmt(notional)} HYPE`} />
        <Row k="Entry price (pessimistic)" v={fmtPrice(entry)} />
        <Row k="Est. liquidation price" v={est ? <span className="text-warn">{fmtPrice(Math.max(0, liq))}</span> : "—"} />
        <Row k="Open fee 0.5%" v={`${fmt(fee, 4)} HYPE`} />
        <Row k="Funding / 1h" v={<span className={fr > 0 === isLong && fr !== 0 ? "text-down" : "text-accent"}>{(fr * 100).toFixed(4)}% {fr === 0 ? "" : fr > 0 ? "(longs pay)" : "(shorts pay)"}</span>} />
        <Row k="Available capacity" v={`${fmt(room)} HYPE`} />
        <Row k="Max profit" v={`${fmt(notional * P.PROFIT_CAP)} HYPE (2/3 of size)`} />
      </div>
      {block ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-warn/20 bg-warn/[0.06] p-3 text-xs text-warn">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" /> {block}
        </div>
      ) : null}
      {chain && chain.heartbeatStale(t) && ms !== "closed" && (
        <button onClick={() => act(() => chain.poke(t.addr), "Market poked — heartbeat updated")} className="btn btn-ghost mt-3 h-10 w-full text-sm">
          <HeartPulse size={15} /> Poke market (heartbeat)
        </button>
      )}
      <button onClick={submit} disabled={!!block || notional <= 0} className={`btn mt-4 h-12 w-full ${isLong ? "btn-accent" : "bg-down text-[#1a0307]"}`}>
        {isLong ? "Open long" : "Open short"} {notional > 0 ? `· ${fmt(notional)} HYPE` : ""}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------

function CurveCard({ e, t }: { e: Engine; t: Token }) {
  const r = useHypeUsd();
  const prog = e.progress(t);
  const age = e.now - t.createdAt;
  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Graduation progress</div>
          <div className="num mt-1 text-3xl font-bold">{(prog * 100).toFixed(1)}%</div>
        </div>
        <div className="num text-right text-sm text-muted">
          {usd(t.realHYPE, r)} / {usd(t.gradTarget, r, 0)}
          <div className="text-xs text-faint">fails if not reached within {dur(P.FAIL_AGE - age)} or after 72h with no trades</div>
        </div>
      </div>
      <Progress v={prog} className="h-2.5" />
      <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs">
        {[
          ["85%", "spot pool (LP burned)"],
          ["10%", "seed Perp Vault"],
          ["5%", "Zephra protocol"],
        ].map(([v, k]) => (
          <div key={k} className="rounded-2xl bg-bg/60 p-3">
            <div className="num text-lg font-bold text-accent">{v}</div>
            <div className="text-muted">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketStats({ e, t }: { e: Engine; t: Token }) {
  const m = t.market!;
  const n = e.nav(t);
  const cap = e.capPerSide(t);
  const util = n > 0 ? e.reserved(t) / n : 0;
  const items: [string, string, string?][] = [
    ["Mark (60s TWAP)", fmtPrice(e.markPrice(t))],
    ["Index (180s TWAP)", fmtPrice(e.twap(t, P.TWAP_EXEC))],
    ["Open interest", `${fmt(m.long.notional + m.short.notional)} HYPE`, `L ${fmt(m.long.notional)} · S ${fmt(m.short.notional)}`],
    ["Cap per side", `${fmt(cap)} HYPE`, "min(50% NAV, 25% of pool)"],
    ["Funding / 1h", `${(e.fundingRate(t) * 3600 * 100).toFixed(4)}%`],
    ["Vault utilization", pct(util, 1), "reserved / NAV"],
    ["Spot/TWAP deviation", pct(e.deviation(t)), "opens blocked above 3%"],
    ["Max leverage", `${e.maxLeverage(t)}x`],
  ];
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">Perp market</h3>
        <StatusBadge e={e} t={t} />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        {items.map(([k, v, s]) => (
          <div key={k}>
            <div className="text-xs text-muted">{k}</div>
            <div className="num mt-0.5 font-semibold">{v}</div>
            {s && <div className="text-[11px] text-faint">{s}</div>}
          </div>
        ))}
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[11px] text-muted">
          <span>Long {pct(m.long.notional / (m.long.notional + m.short.notional || 1), 0)}</span>
          <span>Short {pct(m.short.notional / (m.long.notional + m.short.notional || 1), 0)}</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="bg-accent" style={{ width: `${(m.long.notional / (m.long.notional + m.short.notional || 1)) * 100}%` }} />
          <div className="bg-down" style={{ width: `${(m.short.notional / (m.long.notional + m.short.notional || 1)) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Vault panel
// ----------------------------------------------------------------------

export function VaultPanel({ e, t }: { e: Engine; t: Token }) {
  const m = t.market!;
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("");
  const a = Number(amt) || 0;
  const n = e.nav(t);
  const sp = e.sharePrice(t);
  const mine = m.shares[YOU] ?? 0;
  const locked = m.locked[YOU] ?? 0;
  const avail = e.availableShares(t, YOU);
  const req = m.wreq[YOU];
  const st = e.withdrawStatus(t, YOU);
  const util = n > 0 ? e.reserved(t) / n : 0;
  const ms = e.marketState(t);
  const canDeposit = ms === "warmup" || ms === "active";

  const submit = () => {
    if (mode === "deposit") act(() => e.deposit(YOU, t.addr, a), (s) => `Deposited ${fmt(a)} HYPE → ${fmt(s)} shares`);
    else act(() => e.requestWithdraw(YOU, t.addr, a / sp), "Withdrawal requested — 1-hour cooldown");
    setAmt("");
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">Perp Vault</h3>
        <span className="text-xs text-muted">counterparty to traders</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-bg/60 p-3">
          <div className="text-[11px] text-muted">NAV</div>
          <div className="num text-lg font-bold">{fmt(n)}</div>
        </div>
        <div className="rounded-2xl bg-bg/60 p-3">
          <div className="text-[11px] text-muted">Share price</div>
          <div className="num text-lg font-bold">{sp.toFixed(4)}</div>
        </div>
      </div>
      <div className="mb-1.5 flex justify-between text-[11px] text-muted"><span>Utilization</span><span className="num">{pct(util, 1)}</span></div>
      <Progress v={util} />
      <div className="mt-4 space-y-2">
        <Row k="Your shares" v={`${fmt(mine, 3)} (${fmt(mine * sp)} HYPE)`} />
        {locked > 0 && <Row k={<span className="flex items-center gap-1"><Lock size={11} />Locked</span>} v={fmt(locked, 3)} />}
        <Row k="Free liquidity" v={`${fmt(e.freeLiquidity(t))} HYPE`} />
        <Row k="Vault income" v={`${fmt(m.feesToVault)} HYPE`} />
      </div>
      <div className="mt-4">
        <SegTabs value={mode} onChange={(v) => { setMode(v); setAmt(""); }} items={[{ id: "deposit", label: "Deposit" }, { id: "withdraw", label: "Withdraw" }]} />
      </div>
      <div className="mt-3">
        <AmountInput value={amt} onChange={setAmt} unit="HYPE" max={mode === "deposit" ? e.bal(YOU) : avail * sp} presets={mode === "deposit" ? [10, 50] : undefined} />
      </div>
      <button onClick={submit} disabled={a <= 0 || (mode === "deposit" && !canDeposit)} className="btn btn-accent mt-3 h-11 w-full">
        {mode === "deposit" ? (canDeposit ? "Deposit HYPE" : "Deposits closed") : "Request withdrawal"}
      </button>
      {req && (
        <div className="mt-4 rounded-2xl border border-line2 p-3 text-xs">
          <div className="mb-1 flex justify-between"><span className="text-muted">Withdrawal request</span><span className="num">{fmt(req.shares, 3)} shares</span></div>
          <div className="flex items-center justify-between">
            <span className={st.ready ? "text-accent" : "text-warn"}>{e.now < req.readyAt ? `Cooldown ${dur(req.readyAt - e.now)}` : st.reason}</span>
            <button onClick={() => act(() => e.cancelWithdraw(YOU, t.addr), "Request cancelled")} className="text-muted hover:text-down">Cancel</button>
          </div>
          <p className="mt-2 text-faint">Your shares stay exposed to gains and losses during the cooldown. The keeper executes at the NAV at execution time.</p>
        </div>
      )}
    </div>
  );
}

function CreatorPanel({ e, t }: { e: Engine; t: Token }) {
  const claim = t.creatorClaimable + (t.pool?.creatorFees ?? 0);
  const dev = e.devVested(t) - t.devClaimed;
  return (
    <div className="card border-accent/20 p-5">
      <div className="mb-3 flex items-center gap-2 font-bold">You created this token</div>
      <div className="space-y-2">
        <Row k="Claimable fees" v={`${fmt(claim, 4)} HYPE`} />
        <Row k="Locked tax (unlocks at graduation)" v={`${fmt(t.creatorLockedTax, 4)} HYPE`} />
        <Row k="Locked dev buy" v={`${fmt(t.devLocked - t.devClaimed)} ${t.symbol}`} />
        <Row k="Claimable dev buy" v={`${fmt(Math.max(0, dev))} ${t.symbol}`} />
        {t.market && <Row k="Creator vault shares (locked)" v={fmt(t.market.locked[YOU] ?? 0, 3)} />}
      </div>
      <button onClick={() => act(() => e.claimCreator(YOU, t.addr), (r) => `Claimed ${fmt(r.hype, 4)} HYPE + ${fmt(r.tokens)} ${t.symbol}`)} className="btn btn-ghost mt-4 h-10 w-full text-sm">
        Claim
      </button>
      <button onClick={() => act(() => getChain()!.claimAllFees(), (r) => `Claimed ${fmt(r.hype, 4)} HYPE from all your tokens`)} className="btn btn-ghost mt-2 h-10 w-full text-sm">
        Claim fees from all my tokens
      </button>
      <FeeSplits e={e} t={t} />
    </div>
  );
}

/** Creator-chosen fee recipients: up to 5 wallets, shares adding to 100%. */
function FeeSplits({ e, t }: { e: Engine; t: Token }) {
  const current = t.splits ?? [];
  const [edit, setEdit] = useState(false);
  const [rows, setRows] = useState<{ to: string; pct: string }[]>([]);
  const start = () => {
    setRows(current.length ? current.map((s) => ({ to: s.to, pct: String(s.bps / 100) })) : [{ to: "", pct: "100" }]);
    setEdit(true);
  };
  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const save = (splits: { to: string; bps: number }[]) => {
    const r = act(() => e.setFeeSplits(YOU, t.addr, splits), () => (splits.length ? `Fee splits saved · ${splits.length} recipient${splits.length > 1 ? "s" : ""}` : "Fees go to you again"));
    if (r instanceof Promise) r.then(() => setEdit(false)).catch(() => undefined);
    else if (r) setEdit(false);
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Fee recipients</div>
        {!edit && <button onClick={start} className="text-xs font-semibold text-accent hover:underline">{current.length ? "Edit" : "Split fees"}</button>}
      </div>
      <p className="mt-1 text-xs text-muted">Your curve fees, unlocked tax and 1% of spot volume are paid to these wallets on every claim. Anyone can trigger a claim; funds only go here.</p>
      {!edit && (
        <div className="mt-3 space-y-1.5">
          {current.length === 0 ? (
            <div className="text-xs text-faint">100% to your wallet</div>
          ) : (
            current.map((s) => (
              <div key={s.to} className="flex items-center justify-between text-xs">
                <a href={addrUrl(s.to)} target="_blank" rel="noreferrer" className="num text-muted hover:text-accent">{short(s.to)}</a>
                <span className="num">{(s.bps / 100).toFixed(2)}%</span>
              </div>
            ))
          )}
        </div>
      )}
      {edit && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`Recipient ${i + 1} address`} className="input num min-w-0 flex-1 text-xs" placeholder="0x…" value={r.to} onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, to: ev.target.value.trim() } : x)))} />
              <div className="relative w-[84px] shrink-0">
                <input aria-label={`Recipient ${i + 1} share`} className="input num pr-6 text-xs" value={r.pct} onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: ev.target.value.replace(/[^0-9.]/g, "") } : x)))} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
              </div>
              <button aria-label="Remove recipient" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-down">×</button>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs">
            {rows.length < 5 ? <button onClick={() => setRows([...rows, { to: "", pct: "" }])} className="font-semibold text-accent hover:underline">+ Add recipient</button> : <span className="text-faint">Maximum 5 recipients</span>}
            <span className={`num ${Math.abs(total - 100) < 1e-9 ? "text-accent" : "text-warn"}`}>Total {total.toFixed(2)}%</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button onClick={() => save(rows.map((r) => ({ to: r.to, bps: Math.round((Number(r.pct) || 0) * 100) })))} className="btn btn-accent col-span-2 h-10 text-sm">Save splits</button>
            <button onClick={() => setEdit(false)} className="btn btn-ghost h-10 text-sm">Cancel</button>
          </div>
          {current.length > 0 && <button onClick={() => save([])} className="w-full pt-1 text-center text-xs text-muted hover:text-accent">Send everything to my wallet instead</button>}
        </div>
      )}
    </div>
  );
}

function AboutCard({ e, t }: { e: Engine; t: Token }) {
  const r = useHypeUsd();
  const chain = getChain();
  const extra = (t as Token & { chain?: { pool?: string; market?: string } }).chain;
  const links = [
    t.meta.website && { icon: Globe, label: "Website", href: t.meta.website.startsWith("http") ? t.meta.website : `https://${t.meta.website}` },
    t.meta.x && { icon: AtSign, label: "X", href: `https://x.com/${t.meta.x.replace(/^@/, "")}` },
    t.meta.telegram && { icon: Send, label: "Telegram", href: t.meta.telegram.startsWith("http") ? t.meta.telegram : `https://t.me/${t.meta.telegram.replace(/^@/, "")}` },
  ].filter(Boolean) as { icon: typeof Globe; label: string; href: string }[];
  return (
    <div className="card p-5">
      <h3 className="mb-2 font-bold">About {t.symbol}</h3>
      <p className="text-sm leading-relaxed text-muted">{t.description || t.meta.description || "No description yet."}</p>
      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="btn btn-ghost h-8 px-3 text-xs"><l.icon size={13} />{l.label}</a>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-2">
        <Row k="Supply" v={fmt(t.supply, 0)} />
        <Row k="Dev buy" v={`${((t.devLocked / P.SUPPLY) * 100).toFixed(2)}% of supply`} />
        <Row k="Anti-sniper tax" v={t.taxWindow > 0 ? `${Math.round(t.startTax * 100)}% → 2% over ${t.taxWindow}s` : "off"} />
        <Row k="Graduation target" v={usd(t.gradTarget, r, 0)} />
        <Row k="Perp leverage cap" v={`${t.levCap}x`} />
        <Row k="Creator fees go to" v={t.splits && t.splits.length ? `${t.splits.length} recipient${t.splits.length > 1 ? "s" : ""}` : "the creator"} />
        <Row k="Created" v={ago(e.now - t.createdAt)} />
        {t.gradAt > 0 && <Row k="Graduated" v={ago(e.now - t.gradAt)} />}
      </div>
      {chain && (
        <div className="mt-4 space-y-1.5 border-t border-line pt-4">
          {[
            ["Token", t.addr],
            ["Spot pool", extra?.pool],
            ["Perp market + vault", extra?.market],
          ]
            .filter(([, a]) => a)
            .map(([k, a]) => (
              <a key={k} href={addrUrl(a!)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl px-1 py-1 text-[13px] hover:bg-white/[0.03]">
                <span className="text-muted">{k}</span>
                <span className="num flex items-center gap-1.5">{short(a!)}<ExternalLink size={12} className="text-muted" /></span>
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

/** Plain-language summary of this token's perp rules, with live numbers. */
function PerpRules({ e, t }: { e: Engine; t: Token }) {
  const m = t.market;
  const cap = m ? e.capPerSide(t) : 0;
  const rules = [
    ["Contract", "Isolated TOKEN/HYPE perp, margined and settled in HYPE"],
    ["Counterparty", "This token's Perp Vault (LPs earn fees, funding and trader losses)"],
    ["Leverage", `${t.levCap === 1 ? "1x" : `2x for the first 24h after opening, then ${t.levCap}x`} (creator cap: ${t.levCap}x)`],
    ["Entry / exit price", "Pessimistic: the worse of spot and the 180s TWAP, plus up to 0.5% size impact"],
    ["Open interest cap", m ? `${fmt(cap)} HYPE per side = min(50% of vault NAV, 25% of pool HYPE)` : "min(50% of vault NAV, 25% of pool HYPE) per side"],
    ["Per-wallet limit", "20% of the per-side cap; one position per side"],
    ["Profit cap", "A position auto-closes once profit reaches 2/3 of its size"],
    ["Liquidation", "When equity falls below 10% of size (mark = 60s TWAP); liquidator earns 1%"],
    ["Funding", "Up to 0.1% per hour, paid by the larger side; 50% to the smaller side, 50% to the vault"],
    ["Fees", "0.5% to open and to close (0.3% vault, 0.2% protocol)"],
    ["Safety stops", "New positions blocked if spot/TWAP deviation > 3%, during the 30-min warm-up, a sequencer grace period, or close-only"],
    ["Inactive market", "72h spot volume < 1% of G or pool < 30% of start → close-only for 72h → closed at the 1h TWAP"],
  ];
  return (
    <div className="card p-5 md:p-6">
      <h3 className="mb-1 font-bold">How this perp works</h3>
      <p className="mb-4 text-sm text-muted">{m ? "Live rules for this market." : `These rules apply automatically once ${t.symbol} graduates.`}</p>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rules.map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{k}</div>
            <div className="text-[13px] leading-relaxed text-ink/90">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Bottom tabs: trades, positions, holders
// ----------------------------------------------------------------------

function BottomTabs({ e, t }: { e: Engine; t: Token }) {
  const [tab, setTab] = useState<"trades" | "positions" | "holders">(t.market ? "positions" : "trades");
  const myPos = t.market?.positions.filter((p) => p.trader === YOU) ?? [];
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line p-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "trades", label: "Trades" },
            ...(t.market ? [{ id: "positions" as const, label: `Your positions (${myPos.length})` }] : []),
            { id: "holders", label: "Holders" },
          ]}
        />
      </div>
      {tab === "trades" && <TradesTable e={e} t={t} />}
      {tab === "positions" && <PositionsTable e={e} t={t} list={myPos} />}
      {tab === "holders" && <Holders e={e} t={t} />}
    </div>
  );
}

function TradesTable({ e, t }: { e: Engine; t: Token }) {
  const list = t.trades.slice(0, 40);
  if (!list.length) return <div className="p-5"><Empty>No trades yet</Empty></div>;
  return (
    <div className="no-scrollbar max-h-[420px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-left text-xs text-muted">
            <th className="py-2.5 pl-4 font-medium md:pl-5">Time</th>
            <th className="font-medium">Type</th>
            <th className="hidden font-medium sm:table-cell">Venue</th>
            <th className="text-right font-medium">HYPE</th>
            <th className="hidden text-right font-medium sm:table-cell">Price</th>
            <th className="pr-4 text-right font-medium md:pr-5">Account</th>
          </tr>
        </thead>
        <tbody>
          {list.map((tr) => {
            const up = ["buy", "long", "deposit", "dev buy"].includes(tr.kind);
            return (
              <tr key={tr.id} className="border-t border-line">
                <td className="py-2.5 pl-4 text-xs text-muted md:pl-5">{ago(e.now - tr.t)}</td>
                <td className={`font-semibold capitalize ${tr.kind === "liquidated" ? "text-warn" : up ? "text-accent" : "text-down"}`}>
                  {tr.kind}
                  <span className="ml-1.5 text-[10px] font-normal uppercase text-faint sm:hidden">{tr.venue}</span>
                </td>
                <td className="hidden text-xs uppercase text-muted sm:table-cell">{tr.venue}</td>
                <td className="num text-right">{fmt(tr.hype, 3)}</td>
                <td className="num hidden text-right text-muted sm:table-cell">{tr.venue === "vault" ? tr.price.toFixed(4) : fmtPrice(tr.price)}</td>
                <td className="num pr-4 text-right text-xs text-muted md:pr-5">{tr.who === YOU ? <span className="text-accent">you</span> : short(tr.who)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PositionsTable({ e, t, list }: { e: Engine; t: Token; list: Position[] }) {
  const [addAmt, setAddAmt] = useState<Record<string, string>>({});
  if (!list.length) return <div className="p-5"><Empty>No open positions</Empty></div>;
  return (
    <div>
      <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_1fr_1fr_1.8fr] gap-3 px-5 py-2.5 text-xs text-muted lg:grid">
        <div>Position</div>
        <div className="text-right">Size</div>
        <div className="text-right">Entry</div>
        <div className="text-right">Mark</div>
        <div className="text-right">Liq. price</div>
        <div className="text-right">PnL</div>
        <div />
      </div>
      {list.map((ps) => {
        const { pnl, owed } = e.positionPnl(t, ps, e.markPrice(t));
        const net = pnl - owed;
        const key = `${ps.isLong}`;
        const cells: [string, string, string?][] = [
          ["Size", `${fmt(ps.notional)} HYPE`],
          ["Entry", fmtPrice(ps.entry)],
          ["Mark", fmtPrice(e.markPrice(t))],
          ["Liq. price", fmtPrice(Math.max(0, e.liqPrice(ps))), "text-warn"],
        ];
        return (
          <div key={key} className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-4 md:px-5 lg:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_1fr_1.8fr] lg:items-center lg:gap-3 lg:py-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${ps.isLong ? "bg-accent/15 text-accent" : "bg-down/15 text-down"}`}>{ps.isLong ? "LONG" : "SHORT"}</span>
              <span className="num text-xs text-muted">{(ps.notional / ps.margin).toFixed(1)}x</span>
            </div>
            <div className={`num text-right font-semibold lg:order-6 ${net >= 0 ? "text-accent" : "text-down"}`}>
              {net >= 0 ? "+" : ""}{fmt(net, 4)}
              <span className="ml-1.5 text-[11px] font-normal lg:ml-0 lg:block">{sPct(net / ps.margin)}</span>
            </div>
            {cells.map(([k, v, cls], i) => (
              <div key={k} className={`${["lg:order-2", "lg:order-3", "lg:order-4", "lg:order-5"][i]} lg:text-right`}>
                <div className="text-[11px] text-muted lg:hidden">{k}</div>
                <div className={`num text-sm ${cls ?? ""}`}>{v}</div>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-1.5 lg:order-7 lg:col-span-1 lg:justify-end">
              <input value={addAmt[key] ?? ""} onChange={(ev) => setAddAmt({ ...addAmt, [key]: ev.target.value.replace(/[^0-9.]/g, "") })} placeholder="+ margin" inputMode="decimal" className="num h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-bg px-2.5 text-xs outline-none focus:border-accent/40 lg:h-8 lg:w-20 lg:flex-none" />
              <button aria-label="Add margin" onClick={() => { const v = Number(addAmt[key]); if (v > 0) act(() => e.addMargin(YOU, t.addr, ps.isLong, v), "Margin added"); setAddAmt({ ...addAmt, [key]: "" }); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line2 text-muted hover:text-accent lg:h-8 lg:w-8"><Plus size={14} /></button>
              <button onClick={() => act(() => e.closePosition(YOU, t.addr, ps.isLong), (r) => `Position closed · received ${fmt(r.payout, 4)} HYPE`)} className="btn btn-ghost h-9 shrink-0 px-4 text-xs lg:h-8">Close</button>
            </div>
          </div>
        );
      })}
      <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-[11px] text-faint md:px-5">
        <Info size={12} className="mt-0.5 shrink-0" /> Closes use the pessimistic price (the worse of spot and TWAP). Positions auto-close when profit reaches 2/3 of size. Liquidation price ignores funding.
      </div>
    </div>
  );
}

function Holders({ e, t }: { e: Engine; t: Token }) {
  const list = useMemo(() => Object.entries(t.holders).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 15), [t, e.version]);
  return (
    <div className="p-4 md:p-5">
      {t.pool && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-accent/[0.05] px-3 py-2 text-sm">
          <span className="font-semibold text-accent">Spot pool (LP burned)</span>
          <span className="num">{((t.pool.rT / t.supply) * 100).toFixed(2)}%</span>
        </div>
      )}
      {t.state !== "graduated" && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-accent/[0.05] px-3 py-2 text-sm">
          <span className="font-semibold text-accent">Bonding curve (unsold)</span>
          <span className="num">{(((800_000_000 - t.tokensSold) / t.supply) * 100).toFixed(2)}%</span>
        </div>
      )}
      {t.devLocked - t.devClaimed > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted"><Lock size={12} /> Locked dev buy</span>
          <span className="num">{(((t.devLocked - t.devClaimed) / t.supply) * 100).toFixed(2)}%</span>
        </div>
      )}
      {list.map(([who, v], i) => (
        <div key={who} className="flex items-center justify-between border-t border-line px-3 py-2 text-sm">
          <span className="text-muted"><span className="mr-3 text-faint">{i + 1}</span>{who === YOU ? <span className="text-accent">you</span> : short(who)}</span>
          <span className="num">{((v / t.supply) * 100).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
}
