// First-connect welcome guide: a swipeable glass card shown once per wallet address.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Rocket, GraduationCap, CandlestickChart, Droplets, X } from "lucide-react";
import { useWallet } from "../store";
import { getNetwork } from "../chain/config";
import logoUrl from "../assets/logo.png";

const KEY = "zephra.welcomed";
const seen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
const markSeen = (a: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), a.toLowerCase()])]));
  } catch {
    /* ignore */
  }
};

interface Slide {
  eyebrow: string;
  title: string;
  body: ReactNode;
  art: ReactNode;
}

function Orb({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto grid h-28 w-28 place-items-center sm:h-32 sm:w-32">
      <div className="absolute inset-0 rounded-full bg-accent/25 blur-2xl" />
      <div className="relative grid h-full w-full place-items-center rounded-[34px] border border-white/15 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-10px_30px_rgba(94,232,222,0.12),0_20px_50px_-20px_rgba(94,232,222,0.55)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-3 top-2 h-1/3 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
        {children}
      </div>
    </div>
  );
}

export function WelcomeGuide() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [[i, dir], setPage] = useState<[number, number]>([0, 0]);

  // show once per address, only after the session is settled (not while restoring)
  useEffect(() => {
    if (!w.restoring && w.address && !seen().includes(w.address.toLowerCase())) {
      setPage([0, 0]);
      setOpen(true);
    }
  }, [w.address, w.restoring]);

  const net = getNetwork();
  const slides: Slide[] = [
    {
      eyebrow: "Wallet connected",
      title: "Welcome to Zephra",
      body: (
        <>
          The launchpad where every token that graduates gets its own spot pool and perp market. Here's how it works, in four quick steps.
        </>
      ),
      art: (
        <Orb>
          <img src={logoUrl} alt="" className="h-14 w-14 object-contain drop-shadow-[0_0_18px_rgba(94,232,222,0.6)] sm:h-16 sm:w-16" />
        </Orb>
      ),
    },
    {
      eyebrow: "Step 1",
      title: "Launch on a bonding curve",
      body: <>Create a token in seconds with your logo, links and settings. An optional anti-sniper tax keeps bots out in the first minute.</>,
      art: <Orb><Rocket size={40} className="text-accent" /></Orb>,
    },
    {
      eyebrow: "Step 2",
      title: "Graduate automatically",
      body: <>When the curve hits its target, liquidity moves to a permanent spot pool with burned LP, and a perp market opens.</>,
      art: <Orb><GraduationCap size={42} className="text-accent" /></Orb>,
    },
    {
      eyebrow: "Step 3",
      title: "Trade perps or earn",
      body: <>Go long or short up to 3x with manipulation-resistant pricing, or deposit into the token's Perp Vault to earn fees and funding.</>,
      art: <Orb><CandlestickChart size={40} className="text-accent" /></Orb>,
    },
    {
      eyebrow: "You're all set",
      title: "Bring HYPE to Elysium",
      body: (
        <>
          HYPE pays gas and is the quote asset everywhere.{" "}
          Bridge it from HyperEVM with the official Elysium bridge, then start exploring. New here? Read the <Link to="/docs/quickstart" onClick={() => close()} className="font-semibold text-accent underline underline-offset-4">quickstart</Link>.
        </>
      ),
      art: <Orb><Droplets size={40} className="text-accent" /></Orb>,
    },
  ];
  const last = slides.length - 1;

  function close() {
    if (w.address) markSeen(w.address);
    setOpen(false);
  }
  const go = (d: number) => setPage(([p]) => [Math.min(last, Math.max(0, p + d)), d]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight") go(1);
      if (ev.key === "ArrowLeft") go(-1);
      if (ev.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60 && i < last) go(1);
    else if (swipe > 60 && i > 0) go(-1);
  };

  const s = slides[i];
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-end justify-center bg-black/55 p-3 backdrop-blur-md sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to Zephra"
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 30, scale: 0.97, filter: "blur(10px)" }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            className="relative w-full max-w-[440px] overflow-hidden rounded-[32px] border border-white/12 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_80px_-40px_rgba(94,232,222,0.5)] backdrop-blur-2xl backdrop-saturate-150"
          >
            {/* glass light */}
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[120%] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />

            <button onClick={close} aria-label="Skip" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-muted transition-colors hover:text-ink">
              <X size={16} />
            </button>

            <div className="relative h-[372px] touch-pan-y select-none sm:h-[380px]">
              <AnimatePresence initial={false} custom={dir} mode="popLayout">
                <motion.div
                  key={i}
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ x: d >= 0 ? 160 : -160, opacity: 0, filter: "blur(8px)" }),
                    center: { x: 0, opacity: 1, filter: "blur(0px)" },
                    exit: (d: number) => ({ x: d >= 0 ? -160 : 160, opacity: 0, filter: "blur(8px)" }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.25}
                  onDragEnd={onDragEnd}
                  className="absolute inset-0 flex cursor-grab flex-col items-center px-7 pt-12 text-center active:cursor-grabbing sm:px-9"
                >
                  {s.art}
                  <div className="mt-7 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{s.eyebrow}</div>
                  <h2 className="mt-2 text-2xl font-extrabold tracking-tight">{s.title}</h2>
                  <p className="mt-3 text-[15px] leading-7 text-muted">{s.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-4">
              <button onClick={() => go(-1)} disabled={i === 0} aria-label="Previous" className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-ink transition-opacity disabled:opacity-0">
                <ArrowLeft size={17} />
              </button>
              <div className="flex items-center gap-1.5">
                {slides.map((_, k) => (
                  <button key={k} onClick={() => setPage([k, k > i ? 1 : -1])} aria-label={`Slide ${k + 1}`} className={`h-1.5 rounded-full transition-all duration-300 ${k === i ? "w-6 bg-accent" : "w-1.5 bg-white/25 hover:bg-white/40"}`} />
                ))}
              </div>
              {i < last ? (
                <button onClick={() => go(1)} aria-label="Next" className="grid h-11 w-11 place-items-center rounded-full bg-accent text-[#031413] shadow-[0_8px_24px_-8px_rgba(94,232,222,0.7)]">
                  <ArrowRight size={17} />
                </button>
              ) : (
                <button onClick={close} className="btn btn-accent h-11 px-5 text-sm">
                  <Check size={16} /> Done
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
