export function fmt(n: number, d = 2) {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtH(n: number, d = 2) {
  return fmt(n, d) + " HYPE";
}

/** Small prices with subscript zeros: 0.0₅1234 */
export function fmtPrice(p: number) {
  if (!isFinite(p) || p === 0) return "0";
  if (p >= 1) return p.toFixed(4);
  const s = p.toExponential(3); // 1.234e-6
  const [m, e] = s.split("e");
  const zeros = -Number(e) - 1;
  if (zeros < 3) return p.toFixed(6);
  const sub = String(zeros)
    .split("")
    .map((c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)])
    .join("");
  return `0.0${sub}${m.replace(".", "").slice(0, 4)}`;
}

/** Unsigned percentage (utilization, deviation, impact). */
export function pct(x: number, d = 2) {
  if (!isFinite(x)) return "—";
  return (x * 100).toFixed(d) + "%";
}

/** Signed percentage (changes, PnL). */
export function sPct(x: number, d = 2) {
  if (!isFinite(x)) return "—";
  return (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
}

export function ago(sec: number) {
  if (sec < 60) return `${Math.max(0, Math.floor(sec))}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function dur(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function short(a: string) {
  if (a.length <= 10) return a;
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function clock(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
