import { useSyncExternalStore } from "react";
import { fmt } from "./format";

// HYPE price in USD from Hyperliquid's public price feed, refreshed every minute.
let price: number | null = null;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids" }) });
    const j = (await r.json()) as Record<string, string>;
    const p = Number(j.HYPE);
    if (isFinite(p) && p > 0) { price = p; subs.forEach((f) => f()); }
  } catch { /* keep the last known price; the UI shows "—" until the first one arrives */ }
}

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) { void load(); timer = setInterval(load, 60_000); }
  return () => { subs.delete(cb); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}

/** Current HYPE price in USD (null until loaded). */
export function useHypeUsd() {
  return useSyncExternalStore(subscribe, () => price);
}

/** Format a HYPE amount as dollars, e.g. $5.1K. */
export function usd(hype: number, rate: number | null, d = 2) {
  if (rate === null || !isFinite(hype)) return "—";
  const v = hype * rate;
  if (v !== 0 && Math.abs(v) < 0.01) return "<$0.01";
  return "$" + fmt(v, d);
}
