import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wallet, Coins, LineChart, Vault, Crown, ArrowUpRight } from "lucide-react";
import { useEngine, act } from "../store";
import { YOU, type Engine } from "../engine/engine";
import { Reveal, TokenIcon, Pct, Empty, SectionTitle, StatusBadge } from "../components/ui";
import { fmt, fmtPrice, sPct, ago, dur } from "../lib/format";

function usePortfolio(e: Engine) {
  const holdings = e.tokens
    .map((t) => ({ t, amt: t.holders[YOU] ?? 0 }))
    .filter((h) => h.amt > 1)
    .map((h) => ({ ...h, value: h.amt * e.price(h.t) }))
    .sort((a, b) => b.value - a.value);
  const positions = e.tokens.flatMap((t) => (t.market?.positions ?? []).filter((p) => p.trader === YOU).map((ps) => ({ t, ps })));
  const posEq = positions.reduce((a, { t, ps }) => {
    const { pnl, owed } = e.positionPnl(t, ps, e.markPrice(t));
    return a + Math.max(0, ps.margin + pnl - owed);
  }, 0);
  const lps = e.tokens
    .filter((t) => (t.market?.shares[YOU] ?? 0) > 0)
    .map((t) => ({ t, sh: t.market!.shares[YOU], value: t.market!.shares[YOU] * e.sharePrice(t) }));
  const created = e.tokens.filter((t) => t.creator === YOU);
  const hype = e.bal(YOU);
  const hold = holdings.reduce((a, h) => a + h.value, 0);
  const lp = lps.reduce((a, l) => a + l.value, 0);
  return { holdings, positions, posEq, lps, created, hype, hold, lp, total: hype + hold + lp + posEq };
}

function recent(e: Engine) {
  return e.tokens
    .flatMap((t) => t.trades.filter((tr) => tr.who === YOU).map((tr) => ({ t, tr })))
    .sort((a, b) => b.tr.t - a.tr.t)
    .slice(0, 4);
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Reveal>
      <SectionTitle title={title} />
      <div className="card overflow-hidden">{children}</div>
    </Reveal>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr] gap-3 border-b border-line px-5 py-3 text-xs text-muted sm:grid">
      {cols.map((c, i) => (
        <div key={c} className={i ? "text-right" : ""}>{c}</div>
      ))}
    </div>
  );
}

export default function Portfolio() {
  const e = useEngine();
  const p = usePortfolio(e);
  const parts = [
    { k: "HYPE wallet", v: p.hype, c: "#5EE8DE" },
    { k: "Tokens", v: p.hold, c: "#9ff5ef" },
    { k: "Vault LP", v: p.lp, c: "#2fb8ae" },
    { k: "Perp equity", v: p.posEq, c: "#1d6d67" },
  ];
  const row = "grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-5 py-3.5 sm:grid-cols-[1.6fr_1fr_1fr_1fr]";
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -top-32 left-0 h-[380px] w-[620px] rounded-full bg-accent/[0.07] blur-[120px]" />
      <div className="relative mx-auto max-w-[1400px] px-4 pt-8 md:px-8 md:pt-10">
        <div className="grid gap-4 md:gap-5 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <div className="card h-full p-5 md:p-7">
              <div className="flex items-center gap-2 text-sm text-muted"><Wallet size={15} />Total balance</div>
              <div className="num mt-2 text-[40px] font-bold leading-none tracking-tight md:text-[52px]">{fmt(p.total)}<span className="ml-2 text-lg text-muted md:text-xl">HYPE</span></div>
              <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-white/5 md:mt-7">
                {parts.map((x) => (
                  <div key={x.k} style={{ width: `${(Math.max(0, x.v) / Math.max(1, p.total)) * 100}%`, background: x.c }} />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                {parts.map((x) => (
                  <div key={x.k}>
                    <div className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: x.c }} />{x.k}</div>
                    <div className="num mt-1 text-lg font-semibold">{fmt(x.v)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-line pt-5 md:mt-7">
                <div className="mb-2 text-xs font-semibold text-muted">Your recent activity</div>
                {recent(e).length === 0 && <div className="text-sm text-faint">No activity yet</div>}
                {recent(e).map(({ t, tr }) => (
                  <Link key={tr.id} to={`/token/${t.addr}`} className="flex items-center gap-3 py-1.5 text-sm">
                    <TokenIcon t={t} size={22} />
                    <span className="font-semibold capitalize">{tr.kind}</span>
                    <span className="truncate text-muted">{t.symbol} · {tr.venue}</span>
                    <span className="num ml-auto whitespace-nowrap">{fmt(tr.hype, 2)} HYPE</span>
                    <span className="hidden w-20 text-right text-xs text-faint sm:block">{ago(e.now - tr.t)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </Reveal>
          <div className="grid grid-cols-2 gap-4 md:gap-5">
            {[
              { icon: Coins, k: "Tokens held", v: String(p.holdings.length) },
              { icon: LineChart, k: "Perp positions", v: String(p.positions.length) },
              { icon: Vault, k: "Vault positions", v: String(p.lps.length) },
              { icon: Crown, k: "Tokens you launched", v: String(p.created.length) },
            ].map((c, i) => (
              <Reveal key={c.k} delay={i * 0.05}>
                <div className="card card-hover flex h-full flex-col justify-between p-4 md:p-5">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent"><c.icon size={18} /></div>
                  <div className="mt-5 md:mt-6">
                    <div className="text-xs text-muted">{c.k}</div>
                    <div className="num text-2xl font-bold md:text-3xl">{c.v}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 md:mt-12 xl:grid-cols-2 xl:gap-5 [&>*]:min-w-0">
          <Panel title="Perp positions">
            {p.positions.length === 0 ? (
              <div className="p-5"><Empty>No open positions. <Link to="/trade" className="ml-1 text-accent">Open one in Trade</Link></Empty></div>
            ) : (
              <>
                <Head cols={["Market", "Size (HYPE)", "Entry / mark", "PnL"]} />
                {p.positions.map(({ t, ps }) => {
                  const { pnl, owed } = e.positionPnl(t, ps, e.markPrice(t));
                  const net = pnl - owed;
                  return (
                    <Link key={t.addr + ps.isLong} to={`/token/${t.addr}`} className={`${row} border-t border-line first:border-t-0`}>
                      <div className="flex items-center gap-2.5">
                        <TokenIcon t={t} size={26} />
                        <span className="font-semibold">{t.symbol}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${ps.isLong ? "bg-accent/15 text-accent" : "bg-down/15 text-down"}`}>{ps.isLong ? "LONG" : "SHORT"} {(ps.notional / ps.margin).toFixed(1)}x</span>
                      </div>
                      <div className={`num text-right font-semibold sm:order-last ${net >= 0 ? "text-accent" : "text-down"}`}>{net >= 0 ? "+" : ""}{fmt(net, 4)}<div className="text-[11px] font-normal">{sPct(net / ps.margin)}</div></div>
                      <div className="num text-xs text-muted sm:text-right sm:text-sm sm:text-ink">{fmt(ps.notional)}<span className="sm:hidden"> HYPE</span></div>
                      <div className="num text-right text-xs text-muted">{fmtPrice(ps.entry)} → {fmtPrice(e.markPrice(t))}</div>
                    </Link>
                  );
                })}
              </>
            )}
          </Panel>

          <Panel title="Vault positions">
            {p.lps.length === 0 ? (
              <div className="p-5"><Empty>No vault deposits yet. <Link to="/earn" className="ml-1 text-accent">See Earn</Link></Empty></div>
            ) : (
              <>
                <Head cols={["Vault", "Shares", "Value (HYPE)", "Withdrawal"]} />
                {p.lps.map(({ t, sh, value }) => {
                  const req = t.market!.wreq[YOU];
                  const st = e.withdrawStatus(t, YOU);
                  return (
                    <Link key={t.addr} to={`/token/${t.addr}`} className={`${row} border-t border-line first:border-t-0`}>
                      <div className="flex items-center gap-2.5"><TokenIcon t={t} size={26} /><span className="font-semibold">{t.symbol}</span><StatusBadge e={e} t={t} /></div>
                      <div className="num text-right font-semibold sm:order-3">{fmt(value)}</div>
                      <div className="num text-xs text-muted sm:order-2 sm:text-right sm:text-sm sm:text-ink">{fmt(sh, 3)} shares</div>
                      <div className="text-right text-xs sm:order-4">{req ? <span className={st.ready ? "text-accent" : "text-warn"}>{e.now < req.readyAt ? `cooldown ${dur(req.readyAt - e.now)}` : st.reason}</span> : <span className="text-faint">—</span>}</div>
                    </Link>
                  );
                })}
              </>
            )}
          </Panel>

          <Panel title="Tokens held">
            {p.holdings.length === 0 ? <div className="p-5"><Empty>No tokens yet</Empty></div> : (
              <>
                <Head cols={["Token", "Amount", "24h", "Value (HYPE)"]} />
                {p.holdings.map(({ t, amt, value }) => (
                  <Link key={t.addr} to={`/token/${t.addr}`} className={`${row} border-t border-line first:border-t-0`}>
                    <div className="flex items-center gap-2.5"><TokenIcon t={t} size={26} /><span className="font-semibold">{t.symbol}</span><span className="text-xs text-muted">{t.state === "graduated" ? "spot" : t.state === "failed" ? "sell-only" : "curve"}</span></div>
                    <div className="num text-right font-semibold sm:order-last">{fmt(value)}</div>
                    <div className="num text-xs text-muted sm:text-right sm:text-sm sm:text-ink">{fmt(amt, 0)}<span className="sm:hidden"> {t.symbol}</span></div>
                    <div className="text-right"><Pct v={e.change24h(t)} className="text-xs sm:text-sm" /></div>
                  </Link>
                ))}
              </>
            )}
          </Panel>

          <Panel title="Tokens you launched">
            {p.created.length === 0 ? <div className="p-5"><Empty>You haven't launched a token yet. <Link to="/create" className="ml-1 text-accent">Launch one</Link></Empty></div> : (
              <div>
                {p.created.map((t) => {
                  const claim = t.creatorClaimable + (t.pool?.creatorFees ?? 0);
                  return (
                    <div key={t.addr} className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0">
                      <TokenIcon t={t} size={32} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{t.name} <span className="text-xs text-muted">{t.symbol}</span></div>
                        <div className="text-xs text-faint">{ago(e.now - t.createdAt)} · {t.state === "bonding" ? `${Math.round(e.progress(t) * 100)}% to graduation` : t.state}</div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="num text-sm font-semibold text-accent">{fmt(claim, 4)} HYPE</div>
                        <div className="text-[11px] text-muted">claimable</div>
                      </div>
                      <button onClick={() => act(() => e.claimCreator(YOU, t.addr), (r) => `Claimed ${fmt(r.hype, 4)} HYPE`)} className="btn btn-ghost h-9 px-4 text-xs">Claim</button>
                      <Link to={`/token/${t.addr}`} aria-label="Open token" className="grid h-9 w-9 place-items-center rounded-full border border-line2 text-muted hover:text-accent"><ArrowUpRight size={15} /></Link>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
