import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import { Search, Plus, Zap, Rocket, CandlestickChart, Coins, UserRound, Settings2 } from "lucide-react";
import { Logo, TokenIcon } from "./ui";
import { WalletButton, Modal } from "./WalletUI";
import { useEngine, getChain } from "../store";
import { SITE } from "../site";
import { getNetwork } from "../chain/config";

const LINKS = [
  { to: "/", label: "Launches" },
  { to: "/trade", label: "Trade" },
  { to: "/earn", label: "Earn" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/docs", label: "Docs" },
];

function NetworkChip() {
  useEngine(); // re-renders as the chain state updates
  const chain = getChain();
  const net = getNetwork();
  const bad = !!chain?.lastError;
  const label = bad ? "error" : chain?.ready ? "synced" : "connecting";
  return (
    <Link to={"/docs/contracts"} title={`${net.name} (chain ${net.chainId}) · ${chain?.lastError || label} · view deployed contracts`} className="hidden h-10 shrink-0 items-center gap-2 rounded-full border border-line2 px-3 text-xs hover:border-accent/40 xl:flex">
      <span className={`h-2 w-2 rounded-full ${bad ? "bg-down" : chain?.ready ? "bg-accent" : "bg-faint"}`} />
      <span className="font-semibold">{net.name}</span>
      <span className="num text-muted">{chain?.block ? `#${chain.block}` : "—"}</span>
    </Link>
  );
}

function SearchResults({ q, onPick }: { q: string; onPick: (addr: string) => void }) {
  const e = useEngine();
  const results = q ? e.tokens.filter((t) => (t.name + t.symbol + t.addr).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  if (!q) return null;
  if (!results.length) return <div className="px-3 py-4 text-center text-sm text-muted">No tokens match “{q}”</div>;
  return (
    <>
      {results.map((t) => (
        <button key={t.addr} onMouseDown={() => onPick(t.addr)} onClick={() => onPick(t.addr)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5">
          <TokenIcon t={t} size={26} />
          <div className="min-w-0 truncate text-sm font-semibold">{t.name}</div>
          <div className="ml-auto text-xs text-muted">{t.symbol}</div>
        </button>
      ))}
    </>
  );
}

/** Search: inline field on very wide screens, an icon that opens a dialog elsewhere. */
function SearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = (addr: string) => {
    setQ("");
    setOpen(false);
    nav(`/token/${addr}`);
  };
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);
  return (
    <>
      <div className="relative hidden 2xl:block">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Search tokens…"
          className="h-10 w-60 rounded-full border border-line bg-panel/70 pl-10 pr-4 text-sm outline-none transition focus:border-accent/40"
        />
        {focus && q && (
          <div className="absolute left-0 right-0 top-12 overflow-hidden rounded-2xl border border-line2 bg-panel2/95 p-1.5 shadow-2xl backdrop-blur-xl">
            <SearchResults q={q} onPick={pick} />
          </div>
        )}
      </div>
      <button onClick={() => setOpen(true)} aria-label="Search tokens" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line2 text-muted transition hover:text-accent 2xl:hidden">
        <Search size={16} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search tokens">
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={input} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Name, ticker or address" className="input pl-10 text-sm" />
        </div>
        <SearchResults q={q} onPick={pick} />
        {!q && <div className="py-3 text-center text-xs text-faint">Type to search launched tokens</div>}
      </Modal>
    </>
  );
}

export function Nav() {
  const { scrollY } = useScroll();
  const bgOpacity = useTransform(scrollY, [0, 80], [0, 0.82]);
  const blur = useTransform(scrollY, [0, 80], ["blur(0px)", "blur(18px)"]);
  const border = useTransform(scrollY, [0, 80], ["rgba(255,255,255,0)", "rgba(255,255,255,0.06)"]);

  return (
    <motion.header style={{ borderColor: border }} className="sticky top-0 z-50 border-b">
      <motion.div style={{ opacity: bgOpacity, backdropFilter: blur, WebkitBackdropFilter: blur }} className="absolute inset-0 bg-bg" />
      <div className="relative mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 md:h-[72px] md:gap-6 md:px-8">
        <NavLink to="/" className="shrink-0">
          <Logo />
        </NavLink>
        <nav className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) => `relative rounded-full px-3 py-2 text-sm font-semibold transition-colors xl:px-4 ${isActive ? "text-accent" : "text-muted hover:text-ink"}`}
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  {isActive && <motion.span layoutId="nav-dot" className="absolute -bottom-[9px] left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-accent" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
          <NetworkChip />
          <SearchBox />
          <NavLink to="/create" className="btn btn-ghost hidden h-10 shrink-0 px-4 text-sm xl:inline-flex">
            <Plus size={15} /> Launch token
          </NavLink>
          <WalletButton />
        </div>
      </div>
    </motion.header>
  );
}

const FOOTER_COLS: { title: string; links: [string, string][] }[] = [
  { title: "Product", links: [["Launches", "/"], ["Trade", "/trade"], ["Earn", "/earn"], ["Launch a token", "/create"], ["Portfolio", "/portfolio"]] },
  { title: "Learn", links: [["Documentation", "/docs/introduction"], ["Quickstart", "/docs/quickstart"], ["Mechanics", "/docs/bonding-curve"], ["Fees", "/docs/fees"], ["FAQ", "/docs/faq"]] },
  { title: "Developers", links: [["Smart contracts", "/docs/contracts"], ["Parameters", "/docs/parameters"], ["Keeper", "/docs/keeper"], ["Security", "/docs/security"]] },
  { title: "Legal", links: [["Terms of Use", "/legal/terms"], ["Privacy Policy", "/legal/privacy"], ["Risk Disclosure", "/legal/risk"]] },
];

export function Footer() {
  const socials = (Object.entries(SITE.socials) as [string, string][]).filter(([, url]) => url);
  const label: Record<string, string> = { x: "X", telegram: "Telegram", discord: "Discord", github: "GitHub" };
  return (
    <footer className="mt-20 border-t border-line md:mt-28">
      <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-12 md:px-8 md:pt-16 lg:pb-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)]">
          <div className="max-w-sm">
            <Logo size={26} />
            <p className="mt-4 text-sm leading-6 text-muted">
              The launchpad where every graduated token gets a permanent spot pool and its own perp market, backed by a dedicated vault.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-line2 px-3 py-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Live on Elysium
            </div>
            {(socials.length > 0 || SITE.contactEmail) && (
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {socials.map(([k, url]) => (
                  <a key={k} href={url} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-accent">{label[k] ?? k}</a>
                ))}
                {SITE.contactEmail && <a href={`mailto:${SITE.contactEmail}`} className="text-muted transition-colors hover:text-accent">{SITE.contactEmail}</a>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {FOOTER_COLS.map((c) => (
              <div key={c.title}>
                <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-faint">{c.title}</div>
                <ul className="space-y-2.5">
                  {c.links.map(([l, to]) => (
                    <li key={to}><Link to={to} className="text-sm text-muted transition-colors hover:text-ink">{l}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-faint md:flex-row md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} {SITE.legalEntity || SITE.name} · {SITE.domain}</div>
          <div className="max-w-xl md:text-right">{"Digital assets are highly volatile and you can lose everything. Nothing here is financial advice."} Smart contracts are unaudited; use at your own risk.</div>
        </div>
      </div>
    </footer>
  );
}

/** Bottom navigation for phones and tablets. */
export function MobileNav() {
  const items = [
    { to: "/", label: "Launches", icon: Rocket },
    { to: "/trade", label: "Trade", icon: CandlestickChart },
    { to: "/create", label: "Launch", icon: Zap },
    { to: "/earn", label: "Earn", icon: Coins },
    { to: "/portfolio", label: "Portfolio", icon: UserRound },
  ];
  return (
    <nav style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} className="fixed inset-x-3 bottom-3 z-[80] grid rounded-3xl border border-line2 bg-panel2/90 p-1.5 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2 lg:hidden">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `flex min-w-0 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold ${isActive ? "bg-accent/10 text-accent" : "text-muted"}`}>
          <it.icon size={18} />
          <span className="max-w-full truncate">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
