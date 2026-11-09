import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { ChevronsRight } from "lucide-react";
import type { Engine, Token } from "../engine/engine";
import { Tabs } from "./ui";
import { useHypeUsd } from "../lib/usd";
import { fmtPrice } from "../lib/format";

const INTERVALS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 } as const;
type Iv = keyof typeof INTERVALS;
type Metric = "price" | "mcap";
type Unit = "usd" | "hype";

const UP = "#22c55e";
const DOWN = "#ef4444";
const MAX_FILLED_BARS = 1500; // empty periods are left as blank time slots (no data), only while this stays small

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/**
 * OHLCV from real trades only (curve + spot swaps): open = first trade of the interval, close = last,
 * high/low = extremes, volume = sum of traded HYPE. `scale` converts HYPE-per-token into the chosen unit.
 */
function buildCandles(t: Token, iv: number, scale: number, volScale: number): Candle[] {
  const trades = t.trades
    .filter((x) => (x.venue === "curve" || x.venue === "spot") && x.price > 0 && x.tokens > 0)
    .sort((a, b) => a.t - b.t || a.id - b.id);
  const byBucket = new Map<number, Candle>();
  for (const tr of trades) {
    const b = Math.floor(tr.t / iv) * iv;
    const p = tr.price * scale;
    const c = byBucket.get(b);
    if (!c) byBucket.set(b, { time: b as UTCTimestamp, open: p, high: p, low: p, close: p, volume: tr.hype * volScale, trades: 1 });
    else {
      c.high = Math.max(c.high, p);
      c.low = Math.min(c.low, p);
      c.close = p;
      c.volume += tr.hype * volScale;
      c.trades++;
    }
  }
  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

function withGaps(candles: Candle[], iv: number): (Candle | WhitespaceData<UTCTimestamp>)[] {
  if (candles.length < 2) return candles;
  const span = (candles[candles.length - 1].time - candles[0].time) / iv + 1;
  if (span > MAX_FILLED_BARS) return candles;
  const out: (Candle | WhitespaceData<UTCTimestamp>)[] = [];
  let next = candles[0].time as number;
  for (const c of candles) {
    while (next < c.time) {
      out.push({ time: next as UTCTimestamp });
      next += iv;
    }
    out.push(c);
    next = c.time + iv;
  }
  return out;
}

function compact(n: number, d = 2) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(d) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(d) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US", { minimumFractionDigits: a >= 100 ? 0 : d, maximumFractionDigits: a >= 100 ? 0 : d });
}

function fmtValue(v: number, metric: Metric, unit: Unit) {
  if (!isFinite(v)) return "—";
  const sym = unit === "usd" ? "$" : "";
  const suf = unit === "hype" ? " HYPE" : "";
  if (metric === "mcap") return sym + compact(v) + suf;
  return sym + fmtPrice(v) + suf;
}

function fmtVol(v: number, unit: Unit) {
  return (unit === "usd" ? "$" : "") + compact(v) + (unit === "hype" ? " HYPE" : "");
}

function utc(ts: number) {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export default function PriceChart({ t }: { e: Engine; t: Token }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const cs = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vs = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [iv, setIv] = useState<Iv>("5m");
  const [metric, setMetric] = useState<Metric>("mcap");
  const [unit, setUnit] = useState<Unit>("usd");
  const [atEdge, setAtEdge] = useState(true);
  const [hover, setHover] = useState<Candle | null>(null);
  const rate = useHypeUsd();

  const usdMissing = unit === "usd" && rate === null;
  const fx = unit === "usd" ? rate ?? 0 : 1;
  const scale = (metric === "mcap" ? t.supply : 1) * fx;

  const candles = useMemo(
    () => (usdMissing ? [] : buildCandles(t, INTERVALS[iv], scale, fx)),
    // trades are mutated in place by the engine; length + newest id detect every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, t.trades.length, t.trades[0]?.id, t.trades[0]?.price, iv, scale, fx, usdMissing]
  );
  const rows = useMemo(() => withGaps(candles, INTERVALS[iv]), [candles, iv]);
  const byTime = useMemo(() => new Map(candles.map((c) => [c.time as number, c])), [candles]);
  const byTimeRef = useRef(byTime);
  byTimeRef.current = byTime;
  const fmtRef = useRef({ metric, unit });
  fmtRef.current = { metric, unit };

  const state = useRef({ prevLen: 0, range: null as LogicalRange | null, atEdge: true, key: "" });

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7c8b8a", fontFamily: "JetBrains Mono Variable, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.08, bottom: 0.26 }, minimumWidth: 64 },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 10,
        minBarSpacing: 1.5,
        fixLeftEdge: false,
        shiftVisibleRangeOnNewBar: false,
      },
      localization: { timeFormatter: (ts: number) => utc(ts), priceFormatter: (p: number) => fmtValue(p, fmtRef.current.metric, fmtRef.current.unit) },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(94,232,222,0.35)", labelBackgroundColor: "#0f1516" }, horzLine: { color: "rgba(94,232,222,0.35)", labelBackgroundColor: "#0f1516" } },
    });
    const candle = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: true,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickVisible: true,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: false,
      lastValueVisible: true,
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = orig();
        if (r) {
          // a price can never be negative; keep some air around a single flat candle
          r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
          if (r.priceRange.maxValue - r.priceRange.minValue < r.priceRange.maxValue * 0.02) {
            const mid = r.priceRange.maxValue;
            r.priceRange = { minValue: Math.max(0, mid * 0.97), maxValue: mid * 1.03 };
          }
        }
        return r;
      },
      priceFormat: { type: "custom", formatter: (p: number) => fmtValue(p, fmtRef.current.metric, fmtRef.current.unit), minMove: 1e-12 },
    });
    const vol = c.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "custom", formatter: (v: number) => fmtVol(v, fmtRef.current.unit), minMove: 1e-9 },
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    c.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (!r) return;
      state.current.range = r;
      const edge = r.to >= state.current.prevLen - 1 - 0.5;
      state.current.atEdge = edge;
      setAtEdge(edge);
    });
    c.subscribeCrosshairMove((p) => {
      setHover(p.time !== undefined ? byTimeRef.current.get(p.time as number) ?? null : null);
    });
    chart.current = c;
    cs.current = candle;
    vs.current = vol;
    return () => {
      c.remove();
      chart.current = null;
      cs.current = null;
      vs.current = null;
    };
  }, []);

  // Data -> chart. Zoom / scroll are kept on live updates; they only reset when the view itself changes.
  useEffect(() => {
    const ch = chart.current;
    if (!ch || !cs.current || !vs.current) return;
    const st = state.current;
    const key = `${t.addr}|${iv}|${metric}|${unit}`;
    const viewChanged = key !== st.key;
    const prevLen = st.prevLen;
    const wasAtEdge = st.atEdge;
    const saved = st.range;

    cs.current.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => fmtValue(p, metric, unit), minMove: 1e-12 } });
    cs.current.setData(rows as never);
    vs.current.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)" })));
    st.prevLen = rows.length;
    st.key = key;

    const ts = ch.timeScale();
    if (viewChanged || prevLen === 0) {
      // default view: the latest ~80 slots at a normal candle width, never stretched over a few trades
      const n = rows.length;
      if (n > 0) ts.setVisibleLogicalRange({ from: Math.max(-1, n - 80), to: n - 1 + 6 });
      st.atEdge = true;
      setAtEdge(true);
      ch.priceScale("right").applyOptions({ autoScale: true });
    } else if (wasAtEdge) {
      const delta = rows.length - prevLen;
      if (saved && delta !== 0) ts.setVisibleLogicalRange({ from: saved.from + delta, to: saved.to + delta });
    } else if (saved) {
      ts.setVisibleLogicalRange(saved); // reading history: stay exactly where the user is
    }
  }, [rows, candles, iv, metric, unit, t.addr]);

  const goLatest = useCallback(() => {
    const ts = chart.current?.timeScale();
    if (!ts) return;
    const n = state.current.prevLen;
    const r = state.current.range;
    const width = r ? r.to - r.from : 86;
    ts.setVisibleLogicalRange({ from: n - 1 + 6 - width, to: n - 1 + 6 });
  }, []);

  const shown = hover ?? candles[candles.length - 1] ?? null;
  const change = shown && shown.open > 0 ? (shown.close / shown.open - 1) * 100 : 0;
  const up = shown ? shown.close >= shown.open : true;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">
          {t.symbol}/HYPE <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">{t.state === "graduated" ? "spot pool" : "bonding curve"} · UTC</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={metric} onChange={setMetric} items={[{ id: "price", label: "Price" }, { id: "mcap", label: "Market cap" }]} />
          <Tabs value={unit} onChange={setUnit} items={[{ id: "usd", label: "USD" }, { id: "hype", label: "HYPE" }]} />
          <Tabs value={iv} onChange={setIv} items={(Object.keys(INTERVALS) as Iv[]).map((k) => ({ id: k, label: k }))} />
        </div>
      </div>

      <div className="relative">
        {/* crosshair legend: time, OHLC, volume */}
        <div className="pointer-events-none absolute left-3 top-2 z-10 max-w-[calc(100%-90px)] text-[11px] leading-5">
          {shown ? (
            <>
              <div className="text-muted">{utc(shown.time)} · {INTERVALS[iv] >= 86400 ? "1d" : iv}</div>
              <div className="num flex flex-wrap gap-x-3">
                <span><span className="text-muted">O </span>{fmtValue(shown.open, metric, unit)}</span>
                <span><span className="text-muted">H </span>{fmtValue(shown.high, metric, unit)}</span>
                <span><span className="text-muted">L </span>{fmtValue(shown.low, metric, unit)}</span>
                <span><span className="text-muted">C </span>{fmtValue(shown.close, metric, unit)}</span>
                <span style={{ color: up ? UP : DOWN }}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
                <span><span className="text-muted">Vol </span>{fmtVol(shown.volume, unit)}</span>
                <span className="text-muted">{shown.trades} trade{shown.trades === 1 ? "" : "s"}</span>
              </div>
            </>
          ) : null}
        </div>

        <div ref={box} className="h-[320px] w-full md:h-[420px]" />

        {usdMissing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center text-sm">
            <div className="text-muted">The HYPE/USD rate is not available right now, so USD values cannot be shown. No estimate is used.</div>
            <button className="btn btn-ghost h-9 px-4 text-xs" onClick={() => setUnit("hype")}>Show in HYPE</button>
          </div>
        )}
        {!usdMissing && candles.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">No trades yet for this token.</div>
        )}
        {!atEdge && candles.length > 0 && (
          <button onClick={goLatest} className="btn btn-ghost absolute bottom-10 right-16 z-20 h-8 gap-1 px-3 text-xs" title="Back to the latest data">
            Latest <ChevronsRight size={14} />
          </button>
        )}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
        Built from on-chain trades only. {unit === "usd" ? "USD uses the current HYPE price for all candles." : "Values in HYPE."} Empty periods stay blank.
      </div>
    </div>
  );
}
