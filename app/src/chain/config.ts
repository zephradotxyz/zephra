// Network + deployment settings. Saved in localStorage so a deployment made
// from the browser is remembered; Vite env vars (VITE_*) provide defaults for hosted builds.
import { defineChain, type Address } from "viem";

export interface NetworkSettings {
  name: string;
  chainId: number;
  rpc: string;
  explorer: string; // base URL; links are `${explorer}/tx/<hash>` and `${explorer}/address/<addr>`
}

export interface Deployment {
  launchpad: Address;
  config: Address;
  poolFactory?: Address;
  marketFactory?: Address;
  router?: Address; // Zephra buy/sell router (Uniswap v4)
  quoter?: Address;
  poolManager?: Address;
  fromBlock: string; // block the launchpad was deployed in (decimal string)
}

const env = import.meta.env;

export const ELYSIUM_MAINNET: NetworkSettings = {
  name: "Elysium",
  chainId: Number(env.VITE_CHAIN_ID || 99901),
  rpc: env.VITE_RPC || "",
  explorer: env.VITE_EXPLORER || "",
};

export const DEFAULT_NETWORK = ELYSIUM_MAINNET;

/** Keeper/API base (IPFS uploads + cached IPFS reads). "" = not configured. */
export const API_URL = String(env.VITE_API_URL || "").replace(/\/$/, "");
export const IPFS_GATEWAY = String(env.VITE_IPFS_GATEWAY || "https://ipfs.io/ipfs/").replace(/\/?$/, "/");
/** ipfs://CID → an http URL (own API cache first, public gateway otherwise). */
export function ipfsToHttp(uri: string): string {
  const cid = uri.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  if (!/^[A-Za-z0-9]+$/.test(cid)) return "";
  return API_URL ? `${API_URL}/ipfs/${cid}` : IPFS_GATEWAY + cid;
}

const K = { net: "zephra.network", dep: "zephra.deployment" };

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function getNetwork(): NetworkSettings {
  // a mainnet build always uses the network it was built for: no per-browser overrides
  return ELYSIUM_MAINNET;
}
export function setNetwork(n: Partial<NetworkSettings>) {
  save(K.net, { ...(load<Partial<NetworkSettings>>(K.net) ?? {}), ...n });
}
export function resetNetwork() {
  save(K.net, null);
}

export function getDeployment(): Deployment | null {
  if (env.VITE_LAUNCHPAD && env.VITE_CONFIG) {
    return { launchpad: env.VITE_LAUNCHPAD as Address, config: env.VITE_CONFIG as Address, poolFactory: (env.VITE_POOL_FACTORY || undefined) as Address | undefined, marketFactory: (env.VITE_MARKET_FACTORY || undefined) as Address | undefined, router: (env.VITE_ROUTER || undefined) as Address | undefined, quoter: (env.VITE_QUOTER || undefined) as Address | undefined, poolManager: (env.VITE_POOL_MANAGER || undefined) as Address | undefined, fromBlock: env.VITE_FROM_BLOCK || "0" };
  }
  return null;
}
export function setDeployment(d: Deployment | null) {
  save(K.dep, d);
}

export function chainFor(n: NetworkSettings) {
  return defineChain({
    id: n.chainId,
    name: n.name,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: [n.rpc] } },
    blockExplorers: n.explorer ? { default: { name: "Explorer", url: n.explorer } } : undefined,
  });
}

export const txUrl = (hash: string) => `${getNetwork().explorer}/tx/${hash}`;
export const addrUrl = (a: string) => `${getNetwork().explorer}/address/${a}`;
