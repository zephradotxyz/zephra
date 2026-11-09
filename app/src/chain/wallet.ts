// Wallet connection: injected browser wallets (MetaMask, Rabby, OKX…).
// Also keeps a local history of the transactions sent from this app, for tracking.
import { createPublicClient, createWalletClient, custom, http, type Address, type EIP1193Provider, type Hash, type WalletClient } from "viem";
import { chainFor, getNetwork } from "./config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean };
  }
}

export type WalletKind = "injected";
export interface TxRecord {
  hash: Hash;
  label: string;
  status: "pending" | "success" | "failed";
  time: number;
}

interface WalletState {
  kind: WalletKind | null;
  address: Address | null;
  chainId: number | null;
  txs: TxRecord[];
  /** true while a saved session is being restored on page load */
  restoring: boolean;
}

const KK = "zephra.walletKind";
const KT = "zephra.txs";

function savedKind(): string | null {
  try {
    return localStorage.getItem(KK);
  } catch {
    return null;
  }
}
const state: WalletState = { kind: null, address: null, chainId: null, txs: loadTxs(), restoring: !!savedKind() };
let client: WalletClient | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((f) => f());
};

function loadTxs(): TxRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KT) || "[]");
  } catch {
    return [];
  }
}
function saveTxs() {
  try {
    localStorage.setItem(KT, JSON.stringify(state.txs.slice(0, 50)));
  } catch {
    /* ignore */
  }
}

export const wallet = {
  get state() {
    return state;
  },
  get version() {
    return version;
  },
  subscribe(f: () => void) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  client() {
    if (!client || !state.address) throw new Error("Connect a wallet first");
    return client;
  },
};

export const publicClient = () => {
  const n = getNetwork();
  return createPublicClient({ chain: chainFor(n), transport: http(n.rpc) });
};

export const hasInjected = () => typeof window !== "undefined" && !!window.ethereum;
export const injectedName = () => (window.ethereum?.isRabby ? "Rabby" : window.ethereum?.isMetaMask ? "MetaMask" : "Browser wallet");

let listening = false;
function listenInjected() {
  if (listening || !window.ethereum?.on) return;
  listening = true;
  window.ethereum.on("accountsChanged", (accs: unknown) => {
    const a = (accs as Address[])[0];
    if (state.kind !== "injected") {
      // a saved session whose wallet was locked at load time: restore once it unlocks
      if (a && savedKind() === "injected") window.ethereum!.request({ method: "eth_chainId" }).then((id) => setInjected(a, Number(id)));
      return;
    }
    // The wallet revoked access (or locked): drop the session in the UI but keep the saved
    // preference, so it restores as soon as the wallet authorizes this site again.
    state.address = a ?? null;
    if (a) client = createWalletClient({ chain: chainFor(getNetwork()), transport: custom(window.ethereum!), account: a });
    emit();
  });
  window.ethereum.on("chainChanged", (id: unknown) => {
    state.chainId = Number(id);
    emit();
  });
}

function setInjected(address: Address, chainId: number) {
  client = createWalletClient({ chain: chainFor(getNetwork()), transport: custom(window.ethereum!), account: address });
  state.kind = "injected";
  state.address = address;
  state.chainId = chainId;
  try {
    localStorage.setItem(KK, "injected");
  } catch {
    /* ignore */
  }
  listenInjected();
  emit();
}

/** Ask the injected wallet to switch to (or add) the app's network. */
async function switchToAppChain() {
  const chain = chainFor(getNetwork());
  const wc = createWalletClient({ chain, transport: custom(window.ethereum!) });
  try {
    await wc.switchChain({ id: chain.id });
  } catch {
    await wc.addChain({ chain });
    await wc.switchChain({ id: chain.id });
  }
  state.chainId = chain.id;
  emit();
}

export async function connectInjected() {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  const wc = createWalletClient({ chain: chainFor(getNetwork()), transport: custom(window.ethereum) });
  const [address] = await wc.requestAddresses();
  setInjected(address, await wc.getChainId());
  await switchToAppChain();
  return address;
}

/** Open the wallet's account picker so the user can allow a different account for this site. */
export async function switchAccount() {
  if (!window.ethereum) throw new Error("No browser wallet found.");
  await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  const accs = (await window.ethereum.request({ method: "eth_accounts" })) as Address[];
  if (!accs.length) throw new Error("No account was allowed.");
  setInjected(accs[0], Number(await window.ethereum.request({ method: "eth_chainId" })));
  return accs[0];
}

/** Called before every transaction: make sure an injected wallet is on the app's network. */
export async function ensureChain() {
  if (state.kind !== "injected" || !window.ethereum) return;
  const want = getNetwork().chainId;
  const cur = Number(await window.ethereum.request({ method: "eth_chainId" }));
  if (cur !== want) await switchToAppChain();
}


export function disconnect() {
  client = null;
  state.kind = null;
  state.address = null;
  try {
    localStorage.removeItem(KK);
  } catch {
    /* ignore */
  }
  emit();
}

/** Wallets inject window.ethereum asynchronously; wait briefly for it. */
function waitForInjected(ms = 2500): Promise<boolean> {
  if (window.ethereum) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => resolve(!!window.ethereum);
    window.addEventListener("ethereum#initialized", done, { once: true });
    setTimeout(done, ms);
  });
}

/**
 * Restore the previous session on page load, silently (no wallet popup).
 * The session stays until the user presses Disconnect: an injected wallet reconnects if it still authorizes this site (eth_accounts).
 */
export async function autoConnect() {
  const kind = savedKind();
  try {
    if (kind === "injected" && (await waitForInjected())) {
      const accs = (await window.ethereum!.request({ method: "eth_accounts" })) as Address[];
      if (accs.length) {
        const chainId = Number(await window.ethereum!.request({ method: "eth_chainId" }));
        setInjected(accs[0], chainId);
      } else {
        listenInjected(); // reconnect automatically if the wallet unlocks later
      }
    }
  } finally {
    state.restoring = false;
    emit();
  }
}

export function recordTx(hash: Hash, label: string) {
  state.txs.unshift({ hash, label, status: "pending", time: Math.floor(Date.now() / 1000) });
  saveTxs();
  emit();
}
export function updateTx(hash: Hash, status: TxRecord["status"]) {
  const t = state.txs.find((x) => x.hash === hash);
  if (t) t.status = status;
  saveTxs();
  emit();
}
export function clearTxs() {
  state.txs = [];
  saveTxs();
  emit();
}
