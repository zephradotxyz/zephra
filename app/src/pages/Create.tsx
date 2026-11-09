import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Rocket, Timer, Lock, GraduationCap, Sparkles, ChevronDown, Layers, Globe, Send, AtSign, ShieldCheck, Info, ImagePlus, Trash2 } from "lucide-react";
import { useEngine, act, useWallet } from "../store";
import { Engine, YOU, type Token } from "../engine/engine";
import { P } from "../engine/params";
import { Reveal, TokenIcon, Row, Progress } from "../components/ui";
import { fmt } from "../lib/format";
import { API_URL, getNetwork } from "../chain/config";

function devTokensFor(hype: number, G: number) {
  const v0 = (G * (P.VIRTUAL_TOKENS - P.CURVE_SUPPLY)) / P.CURVE_SUPPLY;
  const net = hype * (1 - P.BOND_FEE);
  return (P.VIRTUAL_TOKENS * net) / (v0 + net);
}

/** Tax curve preview: start → 2% over the window. */
function TaxPreview({ window, start }: { window: number; start: number }) {
  if (window === 0) return <div className="rounded-2xl bg-bg/60 p-4 text-xs text-muted">Anti-sniper tax disabled — buys pay the normal 1% bonding fee from the first block.</div>;
  const w = 300;
  const h = 70;
  const y = (r: number) => h - 6 - (r / 1) * (h - 14);
  return (
    <div className="rounded-2xl bg-bg/60 p-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[70px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="taxg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#5EE8DE" stopOpacity="0.35" />
            <stop offset="1" stopColor="#5EE8DE" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} 0,${y(start)} ${w * 0.8},${y(0.02)} ${w},${y(0.01)} ${w},${h}`} fill="url(#taxg)" />
        <polyline points={`0,${y(start)} ${w * 0.8},${y(0.02)} ${w * 0.8},${y(0.01)} ${w},${y(0.01)}`} fill="none" stroke="#5EE8DE" strokeWidth="2" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span className="num">{Math.round(start * 100)}% at launch</span>
        <span className="num">2% at {window}s</span>
        <span>then 1% fee</span>
      </div>
    </div>
  );
}

/** Resize an uploaded image to a square WebP data URI (512 px for IPFS, ≤ 16 KB for the on-chain fallback). */
async function toLogoDataUri(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read this image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    // IPFS (API configured): a sharp 512 px logo up to ~700 KB. On-chain fallback: ≤ 16 KB.
    const steps = API_URL ? ([[512, 0.9], [384, 0.85], [256, 0.85]] as const) : ([[256, 0.85], [192, 0.8], [128, 0.75], [96, 0.7]] as const);
    const limit = API_URL ? 900_000 : 16_000;
    for (const [size, q] of steps) {
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const side = Math.min(img.width, img.height);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      const out = canvas.toDataURL("image/webp", q);
      if (out.length <= limit) return out;
    }
    throw new Error("Image is too detailed — try a simpler logo");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LogoUpload({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const handle = async (f?: File | null) => {
    if (!f) return;
    setErr("");
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type)) return setErr("Use a PNG, JPG, WebP, GIF or SVG image");
    if (f.size > 5 * 1024 * 1024) return setErr("Max file size is 5 MB");
    try {
      onChange(await toLogoDataUri(f));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div>
      <label
        onDragOver={(ev) => { ev.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(ev) => { ev.preventDefault(); setDrag(false); void handle(ev.dataTransfer.files?.[0]); }}
        className={`flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed p-4 transition ${drag ? "border-accent bg-accent/[0.06]" : "border-line2 hover:border-accent/40"}`}
      >
        {value ? (
          <img src={value} alt="Logo preview" className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent/10 text-accent"><ImagePlus size={22} /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{value ? "Logo ready" : "Upload your logo"}</div>
          <div className="text-xs text-muted">Drag & drop or click · PNG, JPG, WebP, GIF, SVG · up to 5 MB. Cropped to a square and stored {API_URL ? "on IPFS" : "on-chain"}.</div>
        </div>
        {value && (
          <button type="button" aria-label="Remove logo" onClick={(ev) => { ev.preventDefault(); onChange(""); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line2 text-muted hover:text-down"><Trash2 size={15} /></button>
        )}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(ev) => void handle(ev.target.files?.[0])} />
      </label>
      {err && <p className="mt-2 text-xs text-down">{err}</p>}
    </div>
  );
}

export default function Create() {
  const e = useEngine();
  const w = useWallet();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [desc, setDesc] = useState("");
  const [image, setImage] = useState("");
  const hue = 176;
  const [dev, setDev] = useState(0);
  const [adv, setAdv] = useState(true);
  const [taxOn, setTaxOn] = useState(true);
  const [taxWindow, setTaxWindow] = useState(60);
  const [startTax, setStartTax] = useState(100);
  const [levCap, setLevCap] = useState(3);
  const [creatorTax, setCreatorTax] = useState(0); // percent, 0-10
  const [website, setWebsite] = useState("");
  const [xh, setX] = useState("");
  const [tg, setTg] = useState("");
  const [feeRows, setFeeRows] = useState<{ to: string; pct: string }[]>([]);
  const feeTotal = feeRows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const feeSplits = feeRows.map((r) => ({ to: r.to, bps: Math.round((Number(r.pct) || 0) * 100) }));
  const [busy, setBusy] = useState(false);

  const G = e.G;
  const maxDev = useMemo(() => {
    let lo = 0;
    let hi = G;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (devTokensFor(mid, G) <= P.DEV_BUY_MAX) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo * 1000) / 1000;
  }, [G]);
  const devTokens = devTokensFor(dev, G);
  const glyph = (symbol || name || "ZP").slice(0, 2).toUpperCase();
  const total = e.creationFee + dev;
  const needsWallet = !w.address;
  const valid = name.trim().length > 0 && symbol.trim().length > 0 && total <= e.bal(YOU) && !needsWallet;

  const submit = async () => {
    setBusy(true);
    const r = act(
      () =>
        e.createToken(YOU, {
          name,
          symbol,
          description: desc,
          hue,
          glyph,
          image,
          devBuy: dev,
          taxWindow: taxOn ? taxWindow : 0,
          startTax: startTax / 100,
          levCap,
          creatorTax: creatorTax / 100,
          website,
          x: xh,
          telegram: tg,
        }),
      (tk) => `${(tk as Token | undefined)?.symbol ?? symbol} launched!${taxOn ? ` Anti-sniper tax active for ${taxWindow}s` : ""}`
    );
    const t = (await Promise.resolve(r).catch(() => undefined)) as Token | undefined;
    setBusy(false);
    if (t && feeSplits.length) {
      // Fee wallets are a second transaction: the contract only lets the creator set them once the token exists.
      await Promise.resolve(act(() => e.setFeeSplits(YOU, t.addr, feeSplits), () => `Fee wallets saved · ${feeSplits.length} recipient${feeSplits.length > 1 ? "s" : ""}`)).catch(() => undefined);
    }
    if (t) nav(`/token/${t.addr}`);
  };

  // validate live with the same bounds the contract enforces
  let settingsError = "";
  try {
    Engine.checkLaunch({ name: name || "x", symbol: symbol || "X", taxWindow: taxOn ? taxWindow : 0, startTax: startTax / 100, levCap, creatorTax: creatorTax / 100 });
  } catch (err) {
    settingsError = (err as Error).message;
  }
  if (!settingsError && feeRows.length) {
    try {
      Engine.checkSplits(feeSplits);
    } catch (err) {
      settingsError = (err as Error).message;
    }
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[800px] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-[130px]" />
      <div className="relative mx-auto max-w-[1180px] px-4 pt-8 md:px-8 md:pt-10">
        <Reveal>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Launch</div>
          <h1 className="text-[40px] font-extrabold tracking-[-0.03em] md:text-[56px]">Launch a token</h1>
          <p className="mt-1 text-muted">No code needed. Your token graduates to spot + perp markets automatically once the curve raises {fmt(G, G < 100 ? 2 : 0)} HYPE.</p>
        </Reveal>

        <div className="mt-8 grid gap-5 md:mt-10 lg:grid-cols-[1fr_400px] lg:gap-6 [&>*]:min-w-0">
          <div className="flex flex-col gap-5">
            <Reveal delay={0.05}>
              <div className="card p-5 md:p-7">
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">Token name</span>
                    <input className="input" maxLength={32} value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Zephyr Cat" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">Ticker</span>
                    <input className="input uppercase" maxLength={10} value={symbol} onChange={(ev) => setSymbol(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ZCAT" />
                  </label>
                </div>
                <label className="mt-5 block">
                  <span className="mb-2 block text-sm font-semibold">Description</span>
                  <textarea className="input min-h-[96px] resize-none" maxLength={280} value={desc} onChange={(ev) => setDesc(ev.target.value)} placeholder="Describe your token in a sentence or two." />
                </label>
                <div className="mt-5">
                  <span className="mb-2 block text-sm font-semibold">Logo</span>
                  <LogoUpload value={image} onChange={setImage} />
                </div>

                <div className="mt-7">
                  <span className="mb-2 block text-sm font-semibold">Paired with</span>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-xl border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm font-bold">HYPE</span>
                    {["USDC", "kHYPE", "wSPYx", "wQQQx", "wNVDAx", "KNTQ", "OBOL"].map((q) => (
                      <span key={q} aria-disabled="true" className="cursor-not-allowed rounded-xl border border-line2 px-3 py-1.5 text-sm text-muted opacity-60">{q} <span className="ml-1 text-[10px] uppercase tracking-wide">soon</span></span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted">Your token trades against HYPE. More pairs, including stock tokens, are coming soon.</p>
                </div>

                <div className="mt-7 rounded-2xl border border-line2 p-5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold"><Lock size={14} className="text-accent" />Dev buy (optional)</span>
                    <span className="num text-sm font-bold">{fmt(dev, 3)} HYPE</span>
                  </div>
                  <p className="mb-4 text-xs text-muted">No anti-sniper tax (the standard 1% bonding fee applies). Capped at 10% of supply. Locked until graduation, then vests linearly over 3 days. The creator wallet cannot trade this token's perp.</p>
                  <input type="range" className="zr w-full" min={0} max={maxDev} step={maxDev / 200} value={dev} onChange={(ev) => setDev(Number(ev.target.value))} style={{ ["--p" as string]: `${(dev / (maxDev || 1)) * 100}%` }} />
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted">≈ {fmt(devTokens, 0)} tokens</span>
                    <span className={`num font-semibold ${devTokens / P.SUPPLY > 0.09 ? "text-warn" : "text-accent"}`}>{((devTokens / P.SUPPLY) * 100).toFixed(2)}% of 10% max</span>
                  </div>
                  <Progress v={devTokens / P.DEV_BUY_MAX} className="mt-2" />
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <div className="card overflow-hidden">
                <button onClick={() => setAdv(!adv)} className="flex w-full items-center justify-between p-5 text-left md:px-7">
                  <span>
                    <span className="block font-bold">Creator settings</span>
                    <span className="text-sm text-muted">Buy tax for early buyers (anti-sniper), perp leverage, fee wallets and social links</span>
                  </span>
                  <ChevronDown size={18} className={`text-muted transition-transform ${adv ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {adv && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                      <div className="space-y-6 border-t border-line p-5 md:p-7">
                        {/* Anti-sniper */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm font-semibold"><Timer size={14} className="text-accent" />Anti-sniper tax</span>
                            <button onClick={() => setTaxOn(!taxOn)} className={`relative h-6 w-11 rounded-full transition-colors ${taxOn ? "bg-accent" : "bg-white/10"}`} aria-label="Toggle anti-sniper tax">
                              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#031413] transition-all ${taxOn ? "left-[22px]" : "left-0.5"}`} />
                            </button>
                          </div>
                          {taxOn && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              <label>
                                <div className="mb-2 flex justify-between text-xs"><span className="text-muted">Start tax</span><span className="num font-bold">{startTax}%</span></div>
                                <input type="range" className="zr w-full" min={10} max={100} step={1} value={startTax} onChange={(ev) => setStartTax(Number(ev.target.value))} style={{ ["--p" as string]: `${((startTax - 10) / 90) * 100}%` }} />
                                <div className="mt-1 flex justify-between text-[11px] text-faint"><span>10%</span><span>100%</span></div>
                              </label>
                              <label>
                                <div className="mb-2 flex justify-between text-xs"><span className="text-muted">Decay window</span><span className="num font-bold">{taxWindow}s</span></div>
                                <input type="range" className="zr w-full" min={30} max={300} step={5} value={taxWindow} onChange={(ev) => setTaxWindow(Number(ev.target.value))} style={{ ["--p" as string]: `${((taxWindow - 30) / 270) * 100}%` }} />
                                <div className="mt-1 flex justify-between text-[11px] text-faint"><span>30s</span><span>300s</span></div>
                              </label>
                            </div>
                          )}
                          <div className="mt-3"><TaxPreview window={taxOn ? taxWindow : 0} start={startTax / 100} /></div>
                          <p className="mt-2 text-xs text-muted">The tax only applies to buys and always decays linearly to 2%. Tax revenue split is fixed: 50% Zephra, 25% you (unlocked at graduation), 25% the vault.</p>
                        </div>

                        {/* Creator tax */}
                        <div>
                          <div className="mb-3 text-sm font-semibold">Trade tax for you</div>
                          <div className="mb-2 flex flex-wrap gap-2">
                            {[0, 1, 3, 5, 10].map((v) => (
                              <button key={v} onClick={() => setCreatorTax(v)} className={`rounded-xl border px-3 py-1.5 text-sm font-bold transition ${creatorTax === v ? "border-accent/60 bg-accent/10" : "border-line2 hover:border-accent/30"}`}>{v === 0 ? "None" : `${v}%`}</button>
                            ))}
                          </div>
                          <div className="mb-2 flex justify-between text-xs"><span className="text-muted">Tax on every buy and sell</span><span className="num font-bold">{creatorTax}%</span></div>
                          <input type="range" className="zr w-full" min={0} max={10} step={0.5} value={creatorTax} onChange={(ev) => setCreatorTax(Number(ev.target.value))} style={{ ["--p" as string]: `${creatorTax * 10}%` }} />
                          <p className="mt-2 text-xs text-muted">Charged on every buy and sell, on the curve and after graduation, on top of the normal fees. It goes to your fee wallets below. It is permanent: you cannot change it after launch, so buyers can trust it.</p>
                        </div>

                        {/* Perp */}
                        <div>
                          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers size={14} className="text-accent" />Perp market after graduation</div>
                          <div className="grid grid-cols-3 gap-2">
                            {[1, 2, 3].map((l) => (
                              <button key={l} onClick={() => setLevCap(l)} className={`rounded-2xl border p-3 text-center transition ${levCap === l ? "border-accent/60 bg-accent/10" : "border-line2 hover:border-accent/30"}`}>
                                <div className="num text-lg font-bold">{l}x</div>
                                <div className="text-[11px] text-muted">{l === 1 ? "no leverage" : l === 2 ? "conservative" : "maximum"}</div>
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-muted">Max leverage traders can use on your token's perp. Every market is capped at 2x during its first 24 hours, then rises to your cap. All other perp rules are protocol-wide (see the summary).</p>
                        </div>

                        {/* Fee wallets */}
                        <div>
                          <div className="mb-1 text-sm font-semibold">Who receives your fees</div>
                          <p className="mb-3 text-xs text-muted">By default all your earnings (curve fees, your share of the tax, 1% of spot volume) go to the wallet that launches. Add up to 5 wallets, such as a dev, team or external wallet, and set each one's share. Shares must add up to 100%. This needs one extra confirmation right after launch.</p>
                          <div className="space-y-2">
                            {feeRows.map((r, i) => (
                              <div key={i} className="flex gap-2">
                                <input aria-label={`Fee wallet ${i + 1} address`} className="input num min-w-0 flex-1 text-xs" placeholder="0x… wallet address" value={r.to} onChange={(ev) => setFeeRows(feeRows.map((x, j) => (j === i ? { ...x, to: ev.target.value.trim() } : x)))} />
                                <div className="relative w-[84px] shrink-0">
                                  <input aria-label={`Fee wallet ${i + 1} share`} className="input num pr-6 text-xs" inputMode="decimal" value={r.pct} onChange={(ev) => setFeeRows(feeRows.map((x, j) => (j === i ? { ...x, pct: ev.target.value.replace(/[^0-9.]/g, "") } : x)))} />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                                </div>
                                <button aria-label="Remove wallet" onClick={() => setFeeRows(feeRows.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-down">×</button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between text-xs">
                              {feeRows.length < 5 ? (
                                <button onClick={() => setFeeRows([...feeRows, { to: "", pct: feeRows.length ? "" : "100" }])} className="font-semibold text-accent hover:underline">{feeRows.length ? "+ Add wallet" : "+ Send fees to another wallet"}</button>
                              ) : (
                                <span className="text-faint">Maximum 5 wallets</span>
                              )}
                              {feeRows.length > 0 && <span className={`num ${Math.abs(feeTotal - 100) < 1e-9 ? "text-accent" : "text-warn"}`}>Total {feeTotal.toFixed(2)}%</span>}
                            </div>
                          </div>
                        </div>

                        {/* Socials */}
                        <div>
                          <div className="mb-3 text-sm font-semibold">Links (stored {API_URL ? "on IPFS" : "on-chain"})</div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="relative"><Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9 text-sm" value={website} onChange={(ev) => setWebsite(ev.target.value)} placeholder="Website" maxLength={100} /></label>
                            <label className="relative"><AtSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9 text-sm" value={xh} onChange={(ev) => setX(ev.target.value)} placeholder="X handle" maxLength={40} /></label>
                            <label className="relative"><Send size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9 text-sm" value={tg} onChange={(ev) => setTg(ev.target.value)} placeholder="Telegram" maxLength={60} /></label>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          </div>

          <div className="flex flex-col gap-5">
            <Reveal delay={0.1}>
              <div className="card overflow-hidden">
                <div className="relative grid h-[180px] place-items-center md:h-[200px]" style={{ background: `radial-gradient(circle at 50% 35%, hsl(${hue} 60% 22%), hsl(${hue} 40% 6%) 70%)` }}>
                  <motion.div key={glyph + image.length} initial={{ scale: 0.8, filter: "blur(10px)", opacity: 0 }} animate={{ scale: 1, filter: "blur(0px)", opacity: 1 }} transition={{ duration: 0.5 }}>
                    <TokenIcon t={{ hue, glyph, image }} size={96} />
                  </motion.div>
                  <span className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-muted backdrop-blur"><Sparkles size={12} className="text-accent" />Preview</span>
                </div>
                <div className="p-5">
                  <div className="text-lg font-bold">{name || "Token name"} <span className="text-sm font-semibold text-muted">{symbol || "SYM"}</span></div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{desc || "Your token description will appear here."}</p>
                  <div className="mt-4 space-y-2 rounded-2xl bg-bg/60 p-4">
                    <Row k="Creation fee" v={`${fmt(e.creationFee, 3)} HYPE`} />
                    <Row k="Dev buy" v={`${fmt(dev, 3)} HYPE`} />
                    <Row k="Anti-sniper" v={taxOn ? `${startTax}% → 2% over ${taxWindow}s` : "off"} />
                    <Row k="Perp leverage cap" v={`${levCap}x`} />
                    <Row k="Your trade tax" v={creatorTax > 0 ? `${creatorTax}% on every trade` : "none"} />
                    <Row k="Fees go to" v={feeRows.length ? `${feeRows.length} wallet${feeRows.length > 1 ? "s" : ""}` : "your wallet"} />
                    <Row k="Total" v={<span className="font-bold text-accent">{fmt(total, 3)} HYPE</span>} />
                  </div>
                  <button onClick={submit} disabled={!valid || busy || !!settingsError} className="btn btn-accent mt-4 h-12 w-full"><Rocket size={17} />{needsWallet ? "Connect a wallet to launch" : busy ? "Launching…" : `Launch ${symbol || "token"}`}</button>
                  {settingsError && <p className="mt-2 text-xs text-down">{settingsError}</p>}
                  {!needsWallet && total > e.bal(YOU) && <p className="mt-2 text-xs text-down">Insufficient HYPE on the connected account. Click your address at the top, then Switch account, to use a different one.</p>}
                  <p className="mt-2 text-[11px] text-faint">This sends a real transaction to ZephraLaunchpad.createAdvanced on {getNetwork().name}.</p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="card space-y-4 p-5">
                <div className="flex items-center gap-2 text-sm font-bold"><Info size={15} className="text-accent" />What happens after launch</div>
                {[
                  { icon: Timer, t: "1 · Bonding curve", d: `Anyone can buy and sell on the curve (1% fee: 0.5% Zephra, 0.25% you, 0.25% vault). Fails if it doesn't reach ${fmt(G, G < 100 ? 2 : 0)} HYPE within 7 days or sees no trades for 72 hours — then the curve becomes sell-only.` },
                  { icon: GraduationCap, t: "2 · Graduation", d: "At the target: 85% seeds a permanent spot pool (LP burned), 10% seeds the Perp Vault, 5% goes to the protocol. Your locked tax share unlocks." },
                  { icon: Layers, t: "3 · Perp market", d: `Opens after a 30-minute warm-up. Isolated TOKEN/HYPE perp, ${levCap === 1 ? "1x" : `2x on day one, then ${levCap}x`}. The vault is the counterparty; OI per side ≤ min(50% of NAV, 25% of pool HYPE); profit per position capped at 2/3 of size; liquidation below 10% margin; funding up to 0.1%/h.` },
                  { icon: ShieldCheck, t: "4 · Your earnings", d: "1% of all spot volume forever, plus 0.5% minted as vault shares you own (locked until the market closes)." },
                ].map((r) => (
                  <div key={r.t} className="flex gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><r.icon size={16} /></div>
                    <div>
                      <div className="text-sm font-semibold">{r.t}</div>
                      <div className="text-xs leading-relaxed text-muted">{r.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
