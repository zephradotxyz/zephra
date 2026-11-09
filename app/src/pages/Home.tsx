import { useMemo, useState } from "react";
import { useHypeUsd, usd } from "../lib/usd";
import { GlassIconReveal } from "../components/ui/liquid-glass-logo-reveal";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Rocket, Layers, ShieldCheck, Activity, Vault, Timer, Flame, GraduationCap, LineChart } from "lucide-react";
import { useEngine } from "../store";
import type { Engine, Token } from "../engine/engine";
import { Reveal, TokenIcon, Sparkline, sparkData, Pct, StatusBadge, Progress, Tabs, SectionTitle } from "../components/ui";
import { fmt, fmtPrice, ago } from "../lib/format";
import { getChain } from "../store";
import { getDeployment, getNetwork } from "../chain/config";
import heroLogoUrl from "../assets/logo-hero.webp";

type Filter = "mcap" | "new" | "near" | "graduated" | "perp";

export default function Home() {
  const e = useEngine();
  return (
    <div>
      <Hero e={e} />
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <StatsRow e={e} />
        <Trending e={e} />
        <div className="mt-10 grid grid-cols-1 gap-5 md:mt-12 xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0 has-[>:only-child]:xl:grid-cols-1">
          <TokenTable e={e} />
          <SidePanels e={e} />
        </div>
        <HowItWorks />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------

function Hero({ e }: { e: Engine }) {
  const next = e.tokens.filter((t) => t.state === "bonding").sort((a, b) => b.realHYPE - a.realHYPE)[0];

  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.09] blur-[120px]" />
      <div className="relative mx-auto grid max-w-[1400px] items-center gap-6 px-4 pb-6 pt-10 md:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:pb-10 lg:pt-20">
        <div>
          <motion.div initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.7 }} className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.07] px-3.5 py-1.5 text-xs font-semibold text-accent md:mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Built for Elysium · 100 ms blocks
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24, filter: "blur(14px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, delay: 0.05 }} className="text-[40px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[52px] md:text-[68px]">
            Launch a token.
            <br />
            <span className="bg-gradient-to-r from-accent via-[#9ff5ef] to-accent bg-clip-text text-transparent">Graduate</span> to spot + perps.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, delay: 0.15 }} className="mt-5 max-w-[540px] text-[16px] leading-relaxed text-muted md:mt-6 md:text-[17px]">
            Every token trades from the first second in a standard Uniswap v4 pool with locked liquidity and an anti-sniper tax. Once it takes in its graduation target ({fmt(e.G, e.G < 100 ? 2 : 0)} HYPE), it automatically gets an isolated perp market with up to 3x leverage, backed by its own vault.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25 }} className="mt-7 flex flex-wrap gap-3 md:mt-8">
            <Link to="/create" className="btn btn-accent h-12 flex-1 px-7 sm:flex-none">
              <Rocket size={17} /> Launch a token
            </Link>
            <Link to="/trade" className="btn btn-ghost h-12 flex-1 px-7 sm:flex-none">
              Explore markets <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>
        <HeroVisual e={e} next={next} />
      </div>
    </section>
  );
}

function HeroVisual({ e, next }: { e: Engine; next?: Token }) {
  const rate = useHypeUsd();
  // Premium hero: a one-shot liquid glass reveal of the logo and two quiet info cards. No looping motion.
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} className="relative mx-auto aspect-square w-full max-w-[340px] sm:max-w-[420px] lg:max-w-[500px]">
      {/* Liquid glass reveal of the Zephra mark: plays once, then stays still (tap to replay). */}
      <div className="absolute inset-[4%]">
      <GlassIconReveal
        logo={heroLogoUrl}
        label="Zephra"
        look="dark"
        originalColors
        iconPlate
        plateColor="#071012"
        background="#040606"
        loop={false}
        tileSize={250}
        logoScale={0.66}
        finalScale={1.2}
        className="h-full w-full rounded-full [mask-image:radial-gradient(closest-side,#000_72%,transparent)] [-webkit-mask-image:radial-gradient(closest-side,#000_72%,transparent)]"
        tuning={{ dispersion: 1.1, colorBleed: 0.7, startZoom: 1.9, present: 2.6, sheen: 0.8 }}
      />
      </div>
      {[0.94, 0.72].map((s, i) => (
        <div key={i} className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-accent/[0.08]" style={{ width: `${s * 100}%`, height: `${s * 100}%`, transform: "translate(-50%,-50%)" }} />
      ))}
      {next && (
        <Link to={`/token/${next.addr}`} className="absolute bottom-[6%] left-0 w-[200px] rounded-2xl border border-line2 bg-panel2/80 p-3.5 backdrop-blur-xl transition-colors hover:border-accent/40 sm:w-[220px] sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <GraduationCap size={13} className="text-accent" /> Next to graduate
          </div>
          <div className="mb-3 flex items-center gap-2.5">
            <TokenIcon t={next} size={30} />
            <div>
              <div className="text-sm font-bold">{next.symbol}</div>
              <div className="num text-xs text-muted">{usd(next.realHYPE, rate, 0)} / {usd(next.gradTarget, rate, 0)}</div>
            </div>
            <div className="num ml-auto text-sm font-bold text-accent">{Math.round(e.progress(next) * 100)}%</div>
          </div>
          <Progress v={e.progress(next)} />
        </Link>
      )}
      <div className="absolute right-0 top-[8%] rounded-2xl border border-line2 bg-panel2/80 px-4 py-3 backdrop-blur-xl">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Open interest</div>
        <div className="num text-lg font-bold">{usd(e.stats().oi, rate, 0)}</div>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------

function StatsRow({ e }: { e: Engine }) {
  const rate = useHypeUsd();
  const s = e.stats();
  const bonding = e.tokens.filter((t) => t.state === "bonding");
  const heat = bonding.length ? bonding.reduce((a, t) => a + e.progress(t), 0) / bonding.length : 0;
  const cards = [
    { icon: Activity, label: "24h volume", value: usd(s.vol, rate, 0), sub: "curve + spot + perp notional" },
    { icon: Rocket, label: "Tokens launched", value: String(s.launched), sub: `${bonding.length} on the bonding curve` },
    { icon: Vault, label: "Total value locked", value: usd(s.tvl, rate, 0), sub: `curves, pools and ${s.grads} vaults` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {cards.map((c, i) => (
        <Reveal key={c.label} delay={i * 0.06}>
          <div className="card card-hover flex h-full flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 md:p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent md:h-12 md:w-12">
              <c.icon size={19} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted">{c.label}</div>
              <div className="num mt-0.5 truncate text-lg font-bold md:text-[22px]">{c.value}</div>
              <div className="truncate text-[11px] text-faint md:text-xs">{c.sub}</div>
            </div>
          </div>
        </Reveal>
      ))}
      <Reveal delay={0.18}>
        <div className="card card-hover flex h-full flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center md:p-5">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Flame size={13} className="text-accent" /> Graduation heat
            </div>
            <div className="num mt-0.5 text-lg font-bold md:text-[22px]">{Math.round(heat * 100)}</div>
            <div className="text-[11px] text-faint md:text-xs">avg. curve progress</div>
          </div>
          <Gauge v={heat} />
        </div>
      </Reveal>
    </div>
  );
}

function Gauge({ v }: { v: number }) {
  const a = Math.PI * (1 - Math.min(1, v));
  const x = 40 + Math.cos(a) * 30;
  const y = 42 - Math.sin(a) * 30;
  return (
    <svg width="84" height="50" viewBox="0 0 80 50" className="shrink-0">
      <defs>
        <linearGradient id="gg" x1="0" x2="1">
          <stop offset="0" stopColor="#1d4a47" />
          <stop offset="1" stopColor="#5EE8DE" />
        </linearGradient>
      </defs>
      <path d="M10 42 A30 30 0 0 1 70 42" stroke="rgba(255,255,255,0.07)" strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M10 42 A30 30 0 0 1 70 42" stroke="url(#gg)" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${Math.PI * 30 * v} 999`} />
      <line x1="40" y1="42" x2={x} y2={y} stroke="#e8f1f0" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="40" cy="42" r="3.5" fill="#e8f1f0" />
    </svg>
  );
}

// ----------------------------------------------------------------------

function Trending({ e }: { e: Engine }) {
  const rate = useHypeUsd();
  const list = useMemo(() => [...e.tokens].sort((a, b) => e.volume24h(b) - e.volume24h(a)).slice(0, 10), [e, e.version]);
  if (!list.length) return null;
  return (
    <Reveal className="mt-12 md:mt-14">
      <SectionTitle eyebrow="Trending" title="Most active in the last 24h" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-5">
        {list.map((t, i) => (
          <Link key={t.addr} to={`/token/${t.addr}`} className="group min-w-0">
            <div className="relative grid aspect-square place-items-center overflow-hidden rounded-[22px] border border-line transition-colors group-hover:border-accent/30" style={{ background: `radial-gradient(circle at 50% 30%, hsl(${t.hue} 60% 22%), hsl(${t.hue} 40% 7%) 70%)` }}>
              {t.image ? <img src={t.image} alt={t.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <TokenIcon t={t} size={72} />}
              {t.image && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />}
              <div className="absolute left-3 top-3 rounded-full bg-black/60 backdrop-blur-sm"><StatusBadge e={e} t={t} /></div>
            </div>
            <div className="mt-3 flex items-baseline gap-2 truncate text-sm font-semibold">
              <span className="text-muted">{i + 1}</span> <span className="truncate">{t.name}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="num text-base font-bold md:text-lg">{usd(e.marketCap(t), rate, 0)}</span>
              <Pct v={e.change24h(t)} className="text-xs" />
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}

// ----------------------------------------------------------------------

function TokenTable({ e }: { e: Engine }) {
  const rate = useHypeUsd();
  const [f, setF] = useState<Filter>("mcap");
  const nav = useNavigate();
  const rows = useMemo(() => {
    let l = [...e.tokens];
    if (f === "mcap") l.sort((a, b) => e.marketCap(b) - e.marketCap(a));
    if (f === "new") l.sort((a, b) => b.createdAt - a.createdAt);
    if (f === "near") l = l.filter((t) => t.state === "bonding").sort((a, b) => b.realHYPE - a.realHYPE);
    if (f === "graduated") l = l.filter((t) => t.state === "graduated").sort((a, b) => b.gradAt - a.gradAt);
    if (f === "perp") l = l.filter((t) => e.marketState(t) === "active").sort((a, b) => e.nav(b) - e.nav(a));
    return l;
  }, [e, e.version, f]);

  return (
    <Reveal>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line p-3 md:p-4">
          <Tabs
            value={f}
            onChange={setF}
            items={[
              { id: "mcap", label: "Market cap" },
              { id: "new", label: "New" },
              { id: "near", label: "Near graduation" },
              { id: "graduated", label: "Graduated" },
              { id: "perp", label: "Perps live" },
            ]}
          />
          <span className="hidden shrink-0 pr-2 text-xs text-muted sm:block">{rows.length} tokens</span>
        </div>

        {rows.length === 0 && <EmptyTokens />}
        {/* Phones & tablets: cards */}
        <div className="divide-y divide-line lg:hidden">
          {rows.map((t) => (
            <Link key={t.addr} to={`/token/${t.addr}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/[0.03]">
              <TokenIcon t={t} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{t.name}</span>
                  <span className="shrink-0 text-xs text-muted">{t.symbol}</span>
                </div>
                {t.state === "bonding" ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress v={e.progress(t)} className="max-w-[120px]" />
                    <span className="num text-[11px] text-muted">{Math.round(e.progress(t) * 100)}%</span>
                  </div>
                ) : (
                  <div className="mt-1"><StatusBadge e={e} t={t} /></div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-sm font-semibold">{usd(e.marketCap(t), rate, 0)}</div>
                <Pct v={e.change24h(t)} className="text-xs" />
              </div>
            </Link>
          ))}
        </div>

        {/* Desktop: table */}
        <div className={rows.length ? "hidden lg:block" : "hidden"}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="hidden py-3 pl-5 font-medium xl:table-cell">#</th>
                <th className="py-3 pl-5 font-medium xl:pl-0">Token</th>
                <th className="text-right font-medium">Price (HYPE)</th>
                <th className="text-right font-medium">24h</th>
                <th className="pl-6 font-medium">Status</th>
                <th className="hidden text-right font-medium 2xl:table-cell">24h volume</th>
                <th className="text-right font-medium">Market cap</th>
                <th className="hidden pl-6 font-medium 2xl:table-cell">7d</th>
                <th className="pr-5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <motion.tr layout key={t.addr} onClick={() => nav(`/token/${t.addr}`)} className="group cursor-pointer border-t border-line transition-colors hover:bg-white/[0.02]">
                  <td className="hidden py-3.5 pl-5 text-muted xl:table-cell">{i + 1}</td>
                  <td className="py-3.5 pl-5 xl:pl-0">
                    <div className="flex items-center gap-3">
                      <TokenIcon t={t} size={34} />
                      <div>
                        <div className="font-semibold">
                          {t.name} <span className="ml-1 text-xs font-medium text-muted">{t.symbol}</span>
                        </div>
                        <div className="text-[11px] text-faint">{ago(e.now - t.createdAt)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num text-right">{fmtPrice(e.price(t))}</td>
                  <td className="text-right"><Pct v={e.change24h(t)} /></td>
                  <td className="pl-6">
                    {t.state === "bonding" ? (
                      <div className="w-[130px]">
                        <div className="mb-1 flex justify-between text-[11px]"><span className="text-warn">Bonding</span><span className="num text-muted">{Math.round(e.progress(t) * 100)}%</span></div>
                        <Progress v={e.progress(t)} />
                      </div>
                    ) : (
                      <StatusBadge e={e} t={t} />
                    )}
                  </td>
                  <td className="num hidden text-right text-muted 2xl:table-cell">{usd(e.volume24h(t), rate, 0)}</td>
                  <td className="num text-right font-semibold">{usd(e.marketCap(t), rate, 0)}</td>
                  <td className="hidden pl-6 2xl:table-cell"><Sparkline data={sparkData(e, t, 7 * 86400)} w={96} h={30} /></td>
                  <td className="pr-5 text-right">
                    <span className="btn btn-ghost h-8 px-4 text-xs group-hover:border-accent/50 group-hover:text-accent">Trade</span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Reveal>
  );
}

function SidePanels({ e }: { e: Engine }) {
  const sorted = [...e.tokens].filter((t) => t.state !== "failed").sort((a, b) => e.change24h(b) - e.change24h(a));
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();
  if (!sorted.length) return null;
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:flex xl:flex-col">
      <Reveal delay={0.05}><MoverList e={e} title="Top gainers" list={gainers} /></Reveal>
      <Reveal delay={0.1}><MoverList e={e} title="Top losers" list={losers} /></Reveal>
      <Reveal delay={0.15} className="md:col-span-2 xl:col-span-1"><Heatmap e={e} /></Reveal>
    </div>
  );
}

function MoverList({ e, title, list }: { e: Engine; title: string; list: Token[] }) {
  return (
    <div className="card h-full p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">{title}</h3>
        <span className="text-xs text-muted">24h</span>
      </div>
      <div className="flex flex-col">
        {list.map((t, i) => (
          <Link key={t.addr} to={`/token/${t.addr}`} className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-white/[0.03]">
            <span className="w-3 text-xs text-muted">{i + 1}</span>
            <TokenIcon t={t} size={26} />
            <span className="text-sm font-semibold">{t.symbol}</span>
            <span className="ml-auto"><Sparkline data={sparkData(e, t, 86400, 16)} w={56} h={20} /></span>
            <Pct v={e.change24h(t)} className="w-[70px] text-right text-xs" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Heatmap({ e }: { e: Engine }) {
  const list = [...e.tokens].sort((a, b) => e.marketCap(b) - e.marketCap(a)).slice(0, 8);
  const total = list.reduce((a, t) => a + e.marketCap(t), 0) || 1;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Market heatmap</h3>
        <span className="text-xs text-muted">top 8 by market cap</span>
      </div>
      <div className="grid h-[230px] grid-cols-6 grid-rows-4 gap-1.5">
        {list.map((t, i) => {
          const ch = e.change24h(t);
          const span = i < 2 ? "col-span-3 row-span-2" : "col-span-2 row-span-1";
          const strength = Math.min(1, Math.abs(ch) / 0.5);
          const bg = ch >= 0 ? `rgba(94,232,222,${0.08 + strength * 0.32})` : `rgba(255,93,115,${0.08 + strength * 0.32})`;
          return (
            <Link key={t.addr} to={`/token/${t.addr}`} className={`${span} flex min-w-0 flex-col justify-center rounded-xl border border-white/5 px-3 transition hover:brightness-125`} style={{ background: bg }} title={`${((e.marketCap(t) / total) * 100).toFixed(1)}% of top-8 market cap`}>
              <div className={`truncate font-bold ${i < 2 ? "text-lg" : "text-[11px]"}`}>{t.symbol}</div>
              <Pct v={ch} className="text-[11px]" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function EmptyTokens() {
  const dep = getDeployment();
  return (
    <div className="grid place-items-center gap-3 px-6 py-14 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent"><Rocket size={22} /></div>
      <div className="text-lg font-bold">{dep ? "No tokens yet" : "Zephra is not available right now"}</div>
      <p className="max-w-[420px] text-sm text-muted">{dep ? "Be the first to launch a token on Zephra. It graduates to spot + perps automatically." : "Zephra contracts are not configured in this build."}</p>
      {dep && <Link to="/create" className="btn btn-accent mt-1 h-11 px-6 text-sm">Launch a token</Link>}
    </div>
  );
}

// ----------------------------------------------------------------------

function HowItWorks() {
  const steps = [
    { icon: Rocket, title: "Launch", text: "Anyone can create a token. The dev buy is capped at 10% of supply and locked until graduation." },
    { icon: Timer, title: "Anti-sniper", text: "A buy tax that decays to 2% (default 100% over 60s; creators can set 10–100% over 30–300s). 50% to Zephra, 25% to the creator, 25% to the vault." },
    { icon: GraduationCap, title: "Graduate", text: `At the graduation target: 85% seeds the spot pool (LP burned), 10% seeds the vault, 5% goes to the protocol.` },
    { icon: Layers, title: "Spot + perps", text: "An isolated TOKEN/HYPE perp: 2x on day one, then 3x. The vault is the counterparty to traders." },
    { icon: ShieldCheck, title: "Safe by design", text: "Pessimistic pricing, open interest caps, profit capped at 2/3 of size, and a sequencer grace period." },
  ];
  return (
    <section className="mt-20 md:mt-28">
      <Reveal>
        <div className="mx-auto mb-10 max-w-[640px] text-center md:mb-12">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">How it works</div>
          <h2 className="text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-[1.05]">From launch to perp trading, automatically.</h2>
          <p className="mt-4 text-muted">More spot volume means more fees into the vault, which means more perp capacity.</p>
        </div>
      </Reveal>
      <div className="grid gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-5">
        {steps.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.08}>
            <div className="card card-hover relative h-full p-6">
              <div className="num absolute right-5 top-5 text-xs text-faint">0{i + 1}</div>
              <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-accent/10 text-accent">
                <s.icon size={19} />
              </div>
              <div className="mb-2 font-bold">{s.title}</div>
              <p className="text-sm leading-relaxed text-muted">{s.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <div className="card mt-4 grid grid-cols-2 gap-6 p-6 md:mt-5 md:grid-cols-4 md:p-7">
          {[
            ["Spot fee", "2%", "creator 0.75% · vault 0.75% · Zephra 0.5%"],
            ["Leverage", "up to 3x", "2x for the first 24h · creator can cap at 1x/2x"],
            ["OI cap per side", "50% NAV", "and ≤ 25% of pool HYPE"],
            ["Worst-case vault loss", "≈33%", "with profit capped at 2/3 of size"],
          ].map(([k, v, s]) => (
            <div key={k}>
              <div className="flex items-center gap-1.5 text-xs text-muted"><LineChart size={12} />{k}</div>
              <div className="num mt-1 text-2xl font-bold text-accent md:text-3xl">{v}</div>
              <div className="mt-1 text-xs text-faint">{s}</div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
