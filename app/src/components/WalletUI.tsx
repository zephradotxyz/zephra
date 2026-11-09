import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Wallet, X, Copy, ExternalLink, LogOut, KeyRound, Droplets, CheckCircle2, AlertCircle, Loader2, Settings2 } from "lucide-react";
import { useEngine, useWallet, getChain, toast } from "../store";
import { connectInjected, switchAccount, disconnect, hasInjected, injectedName, clearTxs } from "../chain/wallet";
import { addrUrl, getNetwork, txUrl, getDeployment } from "../chain/config";
import { YOU } from "../engine/engine";
import { fmt, short, ago } from "../lib/format";

function useModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  return [open, setOpen] as const;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, filter: "blur(10px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ y: 40, opacity: 0, filter: "blur(10px)" }}
            transition={{ duration: 0.3 }}
            className="no-scrollbar max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-line2 bg-panel2 p-5 shadow-2xl sm:max-w-[440px] sm:rounded-3xl md:p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function WalletButton() {
  const e = useEngine();
  const w = useWallet();
  const [open, setOpen] = useModal();
  return (
    <>
      {w.restoring && !w.address ? (
        <div className="btn btn-ghost h-10 w-[120px] shrink-0 animate-pulse text-sm text-faint sm:w-[170px]" aria-label="Restoring wallet">
          <span className="h-2 w-2 rounded-full bg-faint" /> <span className="num">0x····</span>
        </div>
      ) : w.address ? (
        <button onClick={() => setOpen(true)} className="btn btn-ghost h-10 shrink-0 px-3 text-sm sm:px-4">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="num hidden sm:inline">{fmt(e.bal(YOU), 3)}</span>
          <span className="num">{short(w.address)}</span>
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className="btn btn-accent h-10 shrink-0 px-4 text-sm">
          <Wallet size={15} /> Connect<span className="hidden sm:inline"> wallet</span>
        </button>
      )}
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const e = useEngine();
  const w = useWallet();
  const net = getNetwork();
  const [busy, setBusy] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [showImport, setShowImport] = useState(false);

  const run = async (f: () => unknown) => {
    setBusy(true);
    try {
      await f();
      toast("Wallet connected", "ok");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={w.address ? "Your wallet" : "Connect a wallet"}>
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-bg/60 px-4 py-3 text-xs">
        <span className="text-muted">Network</span>
        <span className="font-semibold">
          {net.name} <span className="num text-muted">· {net.chainId}</span>
        </span>
      </div>
      {!w.address ? (
        <div className="space-y-2.5">
          <button disabled={busy} onClick={() => run(connectInjected)} className="flex w-full items-center gap-3 rounded-2xl border border-line2 p-4 text-left transition hover:border-accent/40">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><Wallet size={18} /></div>
            <div className="flex-1">
              <div className="font-semibold">{hasInjected() ? injectedName() : "Browser wallet"}</div>
              <div className="text-xs text-muted">{hasInjected() ? "MetaMask, Rabby, OKX… — adds Elysium automatically" : "No browser wallet detected"}</div>
            </div>
            {busy && <Loader2 size={16} className="animate-spin text-accent" />}
          </button>
        </div>
      ) : (
        <div>
          <div className="rounded-2xl border border-line2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{injectedName()}</span>
              <span className="text-[11px] text-accent">{w.chainId === net.chainId ? "Connected" : `Wrong network (${w.chainId})`}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="num text-sm font-semibold">{short(w.address)}</span>
              <button aria-label="Copy address" onClick={() => { navigator.clipboard?.writeText(w.address!).catch(() => undefined); toast("Address copied", "ok"); }} className="text-muted hover:text-accent"><Copy size={13} /></button>
              <a aria-label="View on explorer" href={addrUrl(w.address)} target="_blank" rel="noreferrer" className="text-muted hover:text-accent"><ExternalLink size={13} /></a>
            </div>
            <div className="num mt-3 text-2xl font-bold">{fmt(e.bal(YOU), 4)} <span className="text-sm text-muted">HYPE</span></div>
            {e.bal(YOU) < 0.01 && <p className="mt-1 text-xs text-warn">{"This account has no HYPE. If your wallet shows HYPE on another account, press Switch account and allow that one. Otherwise bridge HYPE to Elysium with the official bridge."}</p>}
          </div>
          <div className={"mt-3 grid gap-2 grid-cols-1"}>
            <button disabled={busy} onClick={() => run(switchAccount)} className="btn btn-ghost h-10 text-xs"><Wallet size={14} />Switch account</button>
            <button onClick={() => { disconnect(); onClose(); }} className="btn btn-ghost h-10 text-xs hover:!text-down"><LogOut size={14} />Disconnect</button>
          </div>
          <TxList />
        </div>
      )}
    </Modal>
  );
}

export function TxList({ limit = 8 }: { limit?: number }) {
  const w = useWallet();
  const e = useEngine();
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">Recent transactions</span>
        {w.txs.length > 0 && <button onClick={clearTxs} className="text-faint hover:text-ink">Clear</button>}
      </div>
      {w.txs.length === 0 && <div className="rounded-2xl border border-dashed border-line2 py-5 text-center text-xs text-muted">No transactions yet</div>}
      <div className="space-y-1.5">
        {w.txs.slice(0, limit).map((t) => (
          <a key={t.hash} href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl bg-bg/60 px-3 py-2.5 text-sm hover:bg-white/[0.04]">
            {t.status === "success" ? <CheckCircle2 size={15} className="shrink-0 text-accent" /> : t.status === "failed" ? <AlertCircle size={15} className="shrink-0 text-down" /> : <Loader2 size={15} className="shrink-0 animate-spin text-accent" />}
            <span className="min-w-0 flex-1 truncate">{t.label}</span>
            <span className="num shrink-0 text-[11px] text-faint">{short(t.hash)}</span>
            <span className="hidden shrink-0 text-[11px] text-faint sm:inline">{ago(now - t.time)}</span>
            <ExternalLink size={12} className="shrink-0 text-muted" />
          </a>
        ))}
      </div>
      {e.version < 0 && null}
    </div>
  );
}

/** Bottom-right network status pill (desktop). */
export function NetworkPill() {
  const e = useEngine();
  const chain = getChain();
  const net = getNetwork();
  const dep = getDeployment();
  if (!chain) return null;
  const ok = chain.ready && !chain.lastError;
  return (
    <Link to={"/docs/contracts"} className="fixed bottom-24 right-4 z-[90] hidden items-center gap-2 rounded-full border border-line2 bg-panel2/85 px-3.5 py-2 text-xs font-semibold shadow-2xl backdrop-blur-xl lg:bottom-5 lg:right-5 lg:flex" title={chain.lastError || "Network status"}>
      <span className={`h-2 w-2 rounded-full ${!dep ? "bg-warn" : ok ? "live-dot bg-accent" : "bg-down"}`} />
      <span className="hidden sm:inline">{net.name}</span>
      <span className="num text-muted">{!dep ? "not deployed" : chain.block ? `#${chain.block.toString()}` : "connecting…"}</span>
      {e.version < 0 && null}
    </Link>
  );
}

/** Banner shown when something is missing (deployment, network or wallet funds). */
export function StatusBanner() {
  const e = useEngine();
  const w = useWallet();
  const chain = getChain();
  const [open, setOpen] = useModal();
  if (!chain) return null;
  const dep = getDeployment();
  let text = "";
  let action: React.ReactNode = null;
  if (!dep) {
    text = "Zephra contracts are not configured in this build.";
  } else if (chain.lastError) {
    text = `Network error: ${chain.lastError}`;
  } else if (!w.address) {
    return null; // no banner when no wallet is connected; the header already has a Connect button
  } else if (e.bal(YOU) < 0.001 && chain.ready) {
    text = "Your wallet has no HYPE on Elysium. Bridge HYPE from HyperEVM with the official Elysium bridge.";
  }
  if (!text) return null;
  return (
    <div className="border-b border-accent/20 bg-accent/[0.06]">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs md:px-8">
        <span className="text-ink">{text}</span>
        {action}
      </div>
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
