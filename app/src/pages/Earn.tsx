import { Link } from "react-router-dom";
import { ShieldCheck, Coins, Info, Clock3, ArrowUpRight, Lock } from "lucide-react";
import { useEngine } from "../store";
import { YOU } from "../engine/engine";
import { Reveal, TokenIcon, StatusBadge, Progress, SectionTitle, Sparkline } from "../components/ui";
import { fmt, pct, sPct } from "../lib/format";

export default function Earn() {
  const e = useEngine();
  const vaults = e.tokens.filter((t) => t.market).sort((a, b) => e.nav(b) - e.nav(a));
  const tvl = vaults.reduce((a, t) => a + e.nav(t), 0);
  const fees = vaults.reduce((a, t) => a + t.market!.feesToVault, 0);
  const mine = vaults.reduce((a, t) => a + (t.market!.shares[YOU] ?? 0) * e.sharePrice(t), 0);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -top-40 left-1/3 h-[420px] w-[700px] rounded-full bg-accent/[0.08] blur-[130px]" />
      <div className="relative mx-auto max-w-[1400px] px-4 pt-8 md:px-8 md:pt-10">
        <div className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr] lg:gap-8">
          <Reveal>
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Earn</div>
            <h1 className="text-[38px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[48px] md:text-[60px]">Be the counterparty.<br />Earn fees, funding and PnL.</h1>
            <p className="mt-5 max-w-[580px] text-muted">Every graduated token has its own Perp Vault. Vaults earn 0.75% of spot volume (0.25% as LP income, 0.5% as locked creator shares), 0.3% of perp volume, 50% of funding, and trader losses. Worst-case loss is limited to about 33% of NAV.</p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card grid grid-cols-3 gap-3 p-5 md:gap-4 md:p-6">
              {[
                ["Vault TVL", fmt(tvl, 0)],
                ["Vault income", fmt(fees, 0)],
                ["Your deposits", fmt(mine)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="truncate text-xs text-muted">{k}</div>
                  <div className="num mt-1 truncate text-xl font-bold md:text-2xl">{v}</div>
                  <div className="text-[11px] text-faint">HYPE</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <div className="mt-12 md:mt-14">
          <SectionTitle eyebrow="Vaults" title="All Perp Vaults" />
          {vaults.length === 0 && (
            <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
              <div className="font-bold">No vaults yet</div>
              <p className="max-w-[420px] text-sm text-muted">Every token that graduates gets its own Perp Vault. They will show up here.</p>
              <Link to="/create" className="btn btn-accent mt-2 h-10 px-5 text-sm">Launch a token</Link>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vaults.map((t, i) => {
              const m = t.market!;
              const n = e.nav(t);
              const util = n > 0 ? e.reserved(t) / n : 0;
              const my = (m.shares[YOU] ?? 0) * e.sharePrice(t);
              const ret = e.sharePrice(t) - 1;
              const hist = m.navHist.slice(-40).map((h) => h.v);
              return (
                <Reveal key={t.addr} delay={(i % 3) * 0.07}>
                  <Link to={`/token/${t.addr}`} className="card card-hover group block p-5 md:p-6">
                    <div className="flex items-center gap-3">
                      <TokenIcon t={t} size={40} />
                      <div className="min-w-0">
                        <div className="truncate font-bold">{t.symbol} Vault</div>
                        <div className="truncate text-xs text-muted">{t.name}</div>
                      </div>
                      <div className="ml-auto"><StatusBadge e={e} t={t} /></div>
                    </div>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-xs text-muted">NAV (HYPE)</div>
                        <div className="num text-[26px] font-bold leading-tight md:text-[28px]">{fmt(n)}</div>
                      </div>
                      <Sparkline data={hist.length > 1 ? hist : [n, n]} w={120} h={40} />
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                      <div><div className="text-[11px] text-muted">Since graduation</div><div className={`num font-semibold ${ret >= 0 ? "text-accent" : "text-down"}`}>{sPct(ret, 1)}</div></div>
                      <div><div className="text-[11px] text-muted">Share price</div><div className="num font-semibold">{e.sharePrice(t).toFixed(3)}</div></div>
                      <div><div className="text-[11px] text-muted">Your deposit</div><div className="num font-semibold">{fmt(my)}</div></div>
                    </div>
                    <div className="mt-5">
                      <div className="mb-1.5 flex justify-between text-[11px] text-muted"><span>Utilization</span><span className="num">{pct(util, 1)}</span></div>
                      <Progress v={util} />
                    </div>
                    <div className="mt-5 flex items-center justify-between text-sm font-semibold text-muted group-hover:text-accent">
                      Manage vault <ArrowUpRight size={16} />
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 md:mt-16 md:gap-4 lg:grid-cols-4">
          {[
            { icon: Coins, t: "Income sources", d: "0.25% of spot volume for all LPs, 0.3% of perp volume, 50% of funding, trader losses and leftover liquidation margin." },
            { icon: ShieldCheck, t: "Loss limits", d: "Open interest per side is capped at 50% of NAV and each position's profit at 2/3 of its size, so the worst case is about 33% of NAV." },
            { icon: Clock3, t: "Fair withdrawals", d: "1-hour cooldown during which your shares stay exposed. Executed at the NAV at execution time, from free liquidity only." },
            { icon: Lock, t: "Locked shares", d: "The protocol seed and the creator's shares stay locked until the market closes, so the creator shares the vault's risk." },
          ].map((c, i) => (
            <Reveal key={c.t} delay={i * 0.07}>
              <div className="card h-full p-5 md:p-6">
                <div className="mb-4 grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent"><c.icon size={18} /></div>
                <div className="mb-1.5 font-bold">{c.t}</div>
                <p className="text-sm leading-relaxed text-muted">{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal><p className="mt-6 flex items-start gap-2 text-xs text-faint"><Info size={12} className="mt-0.5 shrink-0" /> "Since graduation" is the change in share price since the vault launched (fees, funding and trader PnL). Read from the vault contract; past performance is not a guarantee of returns.</p></Reveal>
      </div>
    </div>
  );
}
