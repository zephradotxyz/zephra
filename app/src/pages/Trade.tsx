import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Activity, Vault, GraduationCap } from "lucide-react";
import { useEngine } from "../store";
import type { Engine, Token } from "../engine/engine";
import { Reveal, TokenIcon, Pct, StatusBadge, Sparkline, sparkData, Tabs, Progress } from "../components/ui";
import { fmt, fmtPrice, ago } from "../lib/format";
import { useHypeUsd, usd } from "../lib/usd";

type Tab = "perp" | "spot" | "bonding";

export default function Trade() {
  const e = useEngine();
  const rate = useHypeUsd();
  const s = e.stats();
  const grads = e.tokens.filter((t) => t.state === "graduated");
  const tvlVault = grads.reduce((a, t) => a + e.nav(t), 0);
  const cards = [
    { icon: BarChart3, label: "Open interest", value: usd(s.oi, rate, 0), data: grads.map((t) => t.market!.long.notional + t.market!.short.notional) },
    { icon: Activity, label: "24h volume", value: usd(s.vol, rate, 0), data: e.tokens.slice(0, 12).map((t) => e.volume24h(t)) },
    { icon: Vault, label: "Vault TVL", value: usd(tvlVault, rate, 0), data: grads.map((t) => e.nav(t)) },
    { icon: GraduationCap, label: "Perp markets", value: `${grads.filter((t) => e.marketState(t) === "active").length} live`, data: grads.map((_, i) => i + 1) },
  ];
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -top-32 right-0 h-[380px] w-[620px] rounded-full bg-accent/[0.07] blur-[120px]" />
      <div className="relative mx-auto max-w-[1400px] px-4 pt-8 md:px-8 md:pt-10">
        <Reveal>
          <h1 className="text-[40px] font-extrabold tracking-[-0.03em] md:text-[56px]">Markets</h1>
          <p className="mt-1 text-muted">Every Zephra token: isolated perps, spot pools and bonding curves.</p>
        </Reveal>
        <div className="mt-6 grid grid-cols-2 gap-3 md:mt-8 md:gap-4 lg:grid-cols-4">
          {cards.map((c, i) => (
            <Reveal key={c.label} delay={i * 0.06}>
              <div className="card card-hover flex h-full items-center gap-3 p-4 md:gap-4 md:p-5">
                <div className="hidden h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/10 text-accent sm:grid"><c.icon size={18} /></div>
                <div className="min-w-0">
                  <div className="text-xs text-muted">{c.label}</div>
                  <div className="num truncate whitespace-nowrap text-lg font-bold md:text-xl">{c.value}</div>
                </div>
                <div className="ml-auto hidden md:block"><Sparkline data={c.data.length > 1 ? c.data : [0, 0]} w={72} h={30} up /></div>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:mt-6 xl:grid-cols-[minmax(0,1fr)_330px] [&>*]:min-w-0">
          <MarketsTable e={e} />
          <Reveal delay={0.1}><LiveFeed e={e} /></Reveal>
        </div>
      </div>
    </div>
  );
}

function MobileRow({ e, t, tab }: { e: Engine; t: Token; tab: Tab }) {
  const rate = useHypeUsd();
  const m = t.market;
  return (
    <Link to={`/token/${t.addr}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03]">
      <TokenIcon t={t} size={36} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{t.symbol}<span className="text-muted">/HYPE</span></div>
        <div className="mt-0.5 text-[11px] text-muted">
          {tab === "perp" && m && <>OI {fmt(m.long.notional + m.short.notional, 0)} · NAV {fmt(e.nav(t), 0)}</>}
          {tab === "spot" && t.pool && <>Liq. {fmt(t.pool.rH, 0)} · Vol {fmt(e.volume24h(t), 0)}</>}
          {tab === "bonding" && (t.state === "failed" ? "Failed · sell-only" : <span className="flex items-center gap-2"><Progress v={e.progress(t)} className="max-w-[90px]" />{Math.round(e.progress(t) * 100)}%</span>)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-sm">{fmtPrice(e.price(t))}</div>
        <Pct v={e.change24h(t)} className="text-xs" />
      </div>
    </Link>
  );
}

function MarketsTable({ e }: { e: Engine }) {
  const rate = useHypeUsd();
  const [tab, setTab] = useState<Tab>("perp");
  const nav = useNavigate();
  const rows = useMemo(() => {
    if (tab === "bonding") return e.tokens.filter((t) => t.state !== "graduated").sort((a, b) => b.realHYPE - a.realHYPE);
    return e.tokens.filter((t) => t.state === "graduated").sort((a, b) => e.volume24h(b) - e.volume24h(a));
  }, [e, e.version, tab]);
  return (
    <Reveal>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-3 md:p-4">
          <Tabs value={tab} onChange={setTab} items={[{ id: "perp", label: "Perps" }, { id: "spot", label: "Spot" }, { id: "bonding", label: "Bonding" }]} />
          <span className="shrink-0 pr-2 text-xs text-muted">{rows.length} markets</span>
        </div>
        {rows.length === 0 && (
          <div className="grid place-items-center gap-2 px-6 py-12 text-center">
            <div className="font-bold">{tab === "bonding" ? "No tokens on the bonding curve" : "No graduated markets yet"}</div>
            <p className="max-w-[380px] text-sm text-muted">{tab === "bonding" ? "Launch a token to start a bonding curve." : "Markets appear here once a token raises its graduation target."}</p>
            <Link to="/create" className="btn btn-accent mt-2 h-10 px-5 text-sm">Launch a token</Link>
          </div>
        )}
        <div className="divide-y divide-line lg:hidden">
          {rows.map((t) => <MobileRow key={t.addr} e={e} t={t} tab={tab} />)}
        </div>
        <div className={rows.length ? "hidden lg:block" : "hidden"}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-3 pl-5 font-medium">Pair</th>
                <th className="text-right font-medium">Price</th>
                <th className="text-right font-medium">24h</th>
                {tab === "perp" && <>
                  <th className="text-right font-medium">Open interest</th>
                  <th className="hidden text-right font-medium xl:table-cell">Funding / 1h</th>
                  <th className="text-right font-medium">Vault NAV</th>
                  <th className="pl-5 font-medium">Status</th>
                </>}
                {tab === "spot" && <>
                  <th className="text-right font-medium">Liquidity</th>
                  <th className="text-right font-medium">24h volume</th>
                  <th className="text-right font-medium">Market cap</th>
                  <th className="hidden pl-5 font-medium 2xl:table-cell">24h</th>
                </>}
                {tab === "bonding" && <>
                  <th className="text-right font-medium">Raised</th>
                  <th className="pl-6 font-medium">Progress</th>
                  <th className="hidden text-right font-medium xl:table-cell">Age</th>
                  <th className="pl-5 font-medium">Status</th>
                </>}
                <th className="pr-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const m = t.market;
                return (
                  <motion.tr layout key={t.addr} onClick={() => nav(`/token/${t.addr}`)} className="group cursor-pointer border-t border-line hover:bg-white/[0.02]">
                    <td className="py-3.5 pl-5">
                      <div className="flex items-center gap-3">
                        <TokenIcon t={t} size={30} />
                        <span className="font-semibold">{t.symbol}<span className="text-muted">/HYPE</span></span>
                        {tab === "perp" && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-muted">{e.maxLeverage(t)}x</span>}
                      </div>
                    </td>
                    <td className="num text-right">{fmtPrice(e.price(t))}</td>
                    <td className="text-right"><Pct v={e.change24h(t)} /></td>
                    {tab === "perp" && m && <>
                      <td className="num text-right">{usd(m.long.notional + m.short.notional, rate, 0)}</td>
                      <td className="num hidden text-right text-muted xl:table-cell">{(e.fundingRate(t) * 3600 * 100).toFixed(4)}%</td>
                      <td className="num text-right">{usd(e.nav(t), rate, 0)}</td>
                      <td className="pl-5"><StatusBadge e={e} t={t} /></td>
                    </>}
                    {tab === "spot" && t.pool && <>
                      <td className="num text-right">{usd(t.pool.rH, rate, 0)}</td>
                      <td className="num text-right text-muted">{usd(e.volume24h(t), rate, 0)}</td>
                      <td className="num text-right">{usd(e.marketCap(t), rate, 0)}</td>
                      <td className="hidden pl-5 2xl:table-cell"><Sparkline data={sparkData(e, t)} w={90} h={28} /></td>
                    </>}
                    {tab === "bonding" && <>
                      <td className="num text-right">{usd(t.realHYPE, rate, 0)}</td>
                      <td className="pl-6"><div className="w-[120px]"><Progress v={e.progress(t)} /></div></td>
                      <td className="hidden text-right text-xs text-muted xl:table-cell">{ago(e.now - t.createdAt)}</td>
                      <td className="pl-5"><StatusBadge e={e} t={t} /></td>
                    </>}
                    <td className="pr-5 text-right"><span className="btn btn-ghost h-8 px-4 text-xs group-hover:border-accent/50 group-hover:text-accent">Trade</span></td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Reveal>
  );
}

function LiveFeed({ e }: { e: Engine }) {
  const items = e.tokens
    .flatMap((t) => t.trades.slice(0, 6).map((tr) => ({ tr, t })))
    .sort((a, b) => b.tr.t - a.tr.t)
    .slice(0, 14);
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-bold"><span className="live-dot h-2 w-2 rounded-full bg-accent" />Live activity</h3>
      </div>
      <div className="flex flex-col">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted">No on-chain activity yet</div>}
        {items.map(({ tr, t }) => {
          const up = ["buy", "long", "deposit", "dev buy"].includes(tr.kind);
          return (
            <Link to={`/token/${t.addr}`} key={tr.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
              <TokenIcon t={t} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]"><span className={`font-semibold capitalize ${tr.kind === "liquidated" ? "text-warn" : up ? "text-accent" : "text-down"}`}>{tr.kind}</span> <span className="text-muted">{t.symbol} · {tr.venue}</span></div>
                <div className="text-[11px] text-faint">{ago(e.now - tr.t)}</div>
              </div>
              <div className="num text-right text-[13px]">{fmt(tr.hype, 2)}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
