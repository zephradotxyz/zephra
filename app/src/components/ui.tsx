import { motion, AnimatePresence } from "framer-motion";
import logoUrl from "../assets/logo.png";
import type { ReactNode } from "react";
import { useToasts } from "../store";
import type { Engine, Token } from "../engine/engine";
import { CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";

/** Scroll-in animation: blurred -> sharp, rising slightly. */
export function Reveal({ children, delay = 0, className = "", y = 28 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(14px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={logoUrl} alt="Zephra" width={size} height={size} className="shrink-0 drop-shadow-[0_0_12px_rgba(94,232,222,0.35)]" style={{ width: size, height: size }} />
      <span className="text-[17px] font-extrabold tracking-[0.18em]">ZEPHRA</span>
    </div>
  );
}

export function TokenIcon({ t, size = 36 }: { t: Pick<Token, "hue" | "glyph"> & { image?: string }; size?: number }) {
  const h = t.hue;
  if (t.image)
    return (
      <img
        src={t.image}
        alt=""
        className="shrink-0 rounded-full bg-panel2 object-cover"
        style={{ width: size, height: size, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.15), 0 4px 18px -6px rgb(94 232 222 / 0.45)" }}
      />
    );
  return (
    <div
      className="relative shrink-0 grid place-items-center rounded-full font-extrabold text-[#031413] overflow-hidden"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `radial-gradient(circle at 30% 25%, hsl(${h} 90% 82%), hsl(${h} 70% 55%) 55%, hsl(${(h + 40) % 360} 65% 32%))`,
        boxShadow: `inset 0 0 0 1px rgb(255 255 255 / 0.25), 0 4px 18px -6px hsl(${h} 80% 55% / 0.6)`,
      }}
    >
      {t.glyph}
    </div>
  );
}

export function Sparkline({ data, w = 110, h = 32, up }: { data: number[]; w?: number; h?: number; up?: boolean }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / rng) * (h - 6)}`);
  const isUp = up ?? data[data.length - 1] >= data[0];
  const c = isUp ? "#5EE8DE" : "#FF5D73";
  const id = `sg${Math.round(data[0] * 1e12) % 100000}${data.length}${isUp ? 1 : 0}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.28" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Sample n recent price points over a time span for a sparkline. */
export function sparkData(e: Engine, t: Token, span = 86400, n = 28) {
  const from = e.now - span;
  const hist = t.priceHist;
  const out: number[] = [];
  let j = 0;
  let last = hist.length ? hist[0].p : e.price(t);
  for (let i = 0; i < n; i++) {
    const ts = from + (span * i) / (n - 1);
    while (j < hist.length && hist[j].t <= ts) {
      last = hist[j].p;
      j++;
    }
    out.push(last);
  }
  out[n - 1] = e.price(t);
  return out;
}

export function Pct({ v, className = "" }: { v: number; className?: string }) {
  return <span className={`num ${v >= 0 ? "text-accent" : "text-down"} ${className}`}>{(v >= 0 ? "+" : "") + (v * 100).toFixed(2)}%</span>;
}

const BADGE: Record<string, { label: string; cls: string }> = {
  bonding: { label: "Bonding", cls: "text-warn bg-warn/10 border-warn/20" },
  failed: { label: "Failed", cls: "text-down bg-down/10 border-down/20" },
  warmup: { label: "Warm-up", cls: "text-warn bg-warn/10 border-warn/20" },
  active: { label: "Perp Live", cls: "text-accent bg-accent/10 border-accent/25" },
  closeonly: { label: "Close-only", cls: "text-down bg-down/10 border-down/20" },
  closed: { label: "Closed", cls: "text-muted bg-white/5 border-line2" },
};

export function StatusBadge({ e, t }: { e: Engine; t: Token }) {
  const key = t.state === "graduated" ? e.marketState(t)! : t.state;
  const b = BADGE[key];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${b.cls}`}>
      {key === "active" && <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
      {b.label}
    </span>
  );
}

export function Progress({ v, className = "" }: { v: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-accent2 to-accent"
        initial={false}
        animate={{ width: `${Math.max(2, v * 100)}%` }}
        transition={{ duration: 0.6 }}
        style={{ boxShadow: "0 0 12px rgb(94 232 222 / 0.6)" }}
      />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className = "" }: { value: T; onChange: (v: NoInfer<T>) => void; items: { id: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`relative shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors md:px-4 md:py-2 md:text-sm ${value === it.id ? "text-[#031413]" : "text-muted hover:text-ink"}`}
        >
          {value === it.id && <motion.span layoutId={`tab-${items.map((i) => i.id).join("")}`} className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", bounce: 0.18, duration: 0.5 }} />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SegTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: NoInfer<T>) => void; items: { id: T; label: ReactNode; tone?: "up" | "down" }[] }) {
  return (
    <div className="grid rounded-full bg-bg p-1 border border-line" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it) => {
        const on = value === it.id;
        const bg = it.tone === "down" ? "bg-down" : "bg-accent";
        return (
          <button key={it.id} onClick={() => onChange(it.id)} className={`relative rounded-full py-2 text-sm font-bold transition-colors ${on ? "text-[#031413]" : "text-muted hover:text-ink"}`}>
            {on && <motion.span layoutId={`seg-${items.map((i) => i.id).join("")}`} className={`absolute inset-0 rounded-full ${bg}`} transition={{ type: "spring", bounce: 0.15, duration: 0.45 }} />}
            <span className="relative">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Row({ k, v, className = "" }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-[13px] ${className}`}>
      <span className="text-muted">{k}</span>
      <span className="num text-ink text-right">{v}</span>
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[100] flex w-[calc(100%-24px)] max-w-[520px] -translate-x-1/2 flex-col items-center gap-2 lg:bottom-6">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, filter: "blur(8px)" }}
            className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-2xl border border-line2 bg-panel2/95 px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl"
          >
            {t.tone === "ok" ? <CheckCircle2 size={16} className="shrink-0 text-accent" /> : t.tone === "err" ? <AlertCircle size={16} className="shrink-0 text-down" /> : <Loader2 size={16} className="shrink-0 animate-spin text-accent" />}
            <span className="min-w-0">{t.text}</span>
            {t.link && (
              <a href={t.link} target="_blank" rel="noreferrer" className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs font-bold text-accent hover:underline">
                View tx <ExternalLink size={12} />
              </a>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{eyebrow}</div>}
        <h2 className="text-2xl font-extrabold tracking-tight md:text-[28px]">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-line2 py-10 text-sm text-muted">{children}</div>;
}
