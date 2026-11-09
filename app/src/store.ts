import { useEffect, useSyncExternalStore } from "react";
import { Engine, ZephraError } from "./engine/engine";
import { ChainEngine, friendlyError } from "./chain/chainEngine";
import { autoConnect, wallet } from "./chain/wallet";
import { txUrl } from "./chain/config";

let engine: Engine | null = null;
export function getEngine(): Engine {
  if (!engine) engine = new ChainEngine() as unknown as Engine;
  return engine;
}
export function getChain(): ChainEngine | null {
  const e = getEngine();
  return e.isChain ? (e as unknown as ChainEngine) : null;
}

/** Re-render when the engine state (or the wallet) changes. */
export function useEngine() {
  const e = getEngine();
  useSyncExternalStore(
    (cb) => e.subscribe(cb),
    () => e.version
  );
  useSyncExternalStore(
    (cb) => wallet.subscribe(cb),
    () => wallet.version
  );
  return e;
}

export function useWallet() {
  useSyncExternalStore(
    (cb) => wallet.subscribe(cb),
    () => wallet.version
  );
  return wallet.state;
}

let ticking = false;
export function useTicker() {
  useEffect(() => {
    if (ticking) return;
    ticking = true;
    const chain = getChain()!;
    autoConnect().finally(() => chain.sync());
    const ids = [
      // near-realtime while the tab is visible; slow down when it is hidden. Syncs never overlap.
      setInterval(() => { if (!document.hidden) void chain.sync(); }, 1500),
      setInterval(() => { if (document.hidden) void chain.sync(); }, 15000),
      setInterval(() => {
        chain.tick();
        chain.emit();
      }, 1000),
    ];
    const unsub = wallet.subscribe(() => chain.sync());
    return () => {
      ids.forEach(clearInterval);
      unsub();
      ticking = false;
    };
  }, []);
}

// ---------------- toast ----------------
export type Toast = { id: number; text: string; tone: "ok" | "err" | "info"; link?: string };
let toasts: Toast[] = [];
let toastSeq = 1;
const toastListeners = new Set<() => void>();
let toastVersion = 0;
function emitToast() {
  toastVersion++;
  toastListeners.forEach((f) => f());
}
export function toast(text: string, tone: Toast["tone"] = "ok", link?: string, ms = 4200) {
  const id = toastSeq++;
  toasts = [...toasts, { id, text, tone, link }];
  emitToast();
  if (ms > 0)
    setTimeout(() => {
      dismissToast(id);
    }, ms);
  return id;
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToast();
}
export function useToasts() {
  useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastVersion
  );
  return toasts;
}

/**
 * Run an engine action and show feedback. On-chain actions return a promise (wallet confirmation +
 * receipt), which gets a pending toast and an explorer link; validation errors throw synchronously.
 */
export function act<T>(fn: () => T, okText?: string | ((r: Awaited<T>) => string)): T | undefined {
  const e = getEngine();
  const okMsg = (r: Awaited<T>) => (typeof okText === "function" ? okText(r) : okText);
  try {
    const r = fn();
    if (r instanceof Promise) {
      const pending = toast("Confirm in your wallet, then waiting for the block…", "info", undefined, 0);
      r.then((v) => {
        dismissToast(pending);
        const chain = getChain();
        const msg = okMsg(v as Awaited<T>);
        if (msg) toast(msg, "ok", chain?.lastTx ? txUrl(chain.lastTx) : undefined, 7000);
      }).catch((err) => {
        dismissToast(pending);
        toast(err instanceof ZephraError ? err.message : friendlyError(err), "err", undefined, 7000);
      });
      return r;
    }
    e.emit();
    const msg = okMsg(r as Awaited<T>);
    if (msg) toast(msg, "ok");
    return r;
  } catch (err) {
    toast(err instanceof ZephraError ? err.message : String((err as Error).message ?? err), "err");
    return undefined;
  }
}
