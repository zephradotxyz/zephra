// Browser keeper: runs the permissionless upkeep (heartbeat, liquidations, profit-cap closes,
// LP withdrawals, status checks, markFailed) from a dedicated key while this tab is open.
// For production, run the Node keeper in /keeper instead.
import { createWalletClient, http, type Abi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import artifacts from "./artifacts.json";
import { chainFor, getNetwork } from "./config";
import { publicClient } from "./wallet";
import type { ChainEngine } from "./chainEngine";

const KK = "zephra.keeperKey";
const A = { lp: artifacts.ZephraLaunchpad.abi as Abi, mkt: artifacts.PerpMarket.abi as Abi };

export interface KeeperState {
  running: boolean;
  address: Address;
  log: { t: number; text: string }[];
  stats: { pokes: number; liquidations: number; profitCaps: number; withdrawals: number; statusChecks: number; failed: number; errors: number };
}

function key(): `0x${string}` {
  try {
    let k = localStorage.getItem(KK) as `0x${string}` | null;
    if (!k) {
      k = generatePrivateKey();
      localStorage.setItem(KK, k);
    }
    return k;
  } catch {
    return generatePrivateKey();
  }
}

const account = privateKeyToAccount(key());
export const keeper: KeeperState = {
  running: false,
  address: account.address,
  log: [],
  stats: { pokes: 0, liquidations: 0, profitCaps: 0, withdrawals: 0, statusChecks: 0, failed: 0, errors: 0 },
};
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((f) => f());
};
export const keeperStore = {
  subscribe: (f: () => void) => {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  version: () => version,
};

function note(text: string) {
  keeper.log.unshift({ t: Math.floor(Date.now() / 1000), text });
  keeper.log = keeper.log.slice(0, 40);
  emit();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastStatus = 0;

async function send(address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
  const n = getNetwork();
  const pc = publicClient();
  const wc = createWalletClient({ chain: chainFor(n), transport: http(n.rpc), account });
  try {
    const { request } = await pc.simulateContract({ address, abi, functionName, args, account } as never);
    const hash = await wc.writeContract(request as never);
    await pc.waitForTransactionReceipt({ hash });
    return true;
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? String(e);
    if (!/healthy|not at cap|not failable|cooldown|no free liquidity/.test(msg)) {
      keeper.stats.errors++;
      note(`${functionName} failed: ${msg.slice(0, 80)}`);
    }
    return false;
  }
}

async function round(e: ChainEngine) {
  const pc = publicClient();
  const now = Number((await pc.getBlock()).timestamp);
  const doStatus = Date.now() - lastStatus > 60_000;
  if (doStatus) lastStatus = Date.now();
  const L = e.dep!.launchpad;
  for (const t of e.keeperView()) {
    if (t.state === "bonding") {
      if (doStatus && e.failable(t) && (await send(L, A.lp, "markFailed", [t.addr]))) {
        keeper.stats.failed++;
        note(`markFailed ${t.symbol}`);
      }
      continue;
    }
    const m = t.chain.market;
    if (!m || !t.market) continue;
    if (t.market.state === "closed") {
      for (const k of [...t.chain.openKeys]) {
        const [trader, isLong] = k.split(":");
        if (await send(m, A.mkt, "settle", [trader, isLong === "true"])) note(`settled ${t.symbol} ${trader.slice(0, 8)}`);
      }
      continue;
    }
    if (now - t.chain.lastHeartbeat > 20 && (await send(m, A.mkt, "poke"))) {
      keeper.stats.pokes++;
    }
    for (const k of [...t.chain.openKeys]) {
      const [trader, isLongS] = k.split(":");
      const isLong = isLongS === "true";
      const liq = (await pc.readContract({ address: m, abi: A.mkt, functionName: "isLiquidatable", args: [trader, isLong] })) as boolean;
      if (liq) {
        if (await send(m, A.mkt, "liquidate", [trader, isLong])) {
          keeper.stats.liquidations++;
          note(`liquidated ${t.symbol} ${trader.slice(0, 8)} ${isLong ? "long" : "short"}`);
        }
        continue;
      }
      const cap = (await pc.readContract({ address: m, abi: A.mkt, functionName: "atProfitCap", args: [trader, isLong] })) as boolean;
      if (cap && (await send(m, A.mkt, "forceCloseAtCap", [trader, isLong]))) {
        keeper.stats.profitCaps++;
        note(`profit cap close ${t.symbol} ${trader.slice(0, 8)}`);
      }
    }
    for (const lpAddr of [...t.chain.lps]) {
      const [sh, readyAt] = (await pc.readContract({ address: m, abi: A.mkt, functionName: "withdrawReq", args: [lpAddr] })) as [bigint, bigint];
      if (sh > 0n && Number(readyAt) <= now && t.chain.free > 0 && (await send(m, A.mkt, "executeWithdraw", [lpAddr]))) {
        keeper.stats.withdrawals++;
        note(`withdrawal executed ${t.symbol} ${lpAddr.slice(0, 8)}`);
      }
    }
    if (doStatus && (await send(m, A.mkt, "checkStatus"))) keeper.stats.statusChecks++;
  }
}

export function startKeeper(e: ChainEngine) {
  if (keeper.running) return;
  keeper.running = true;
  note("keeper started");
  const loop = async () => {
    if (!keeper.running) return;
    try {
      if (e.dep) await round(e);
    } catch (err) {
      keeper.stats.errors++;
      note(`round error: ${String((err as Error).message ?? err).slice(0, 80)}`);
    }
    emit();
    timer = setTimeout(loop, 10_000);
  };
  void loop();
}

export function stopKeeper() {
  keeper.running = false;
  if (timer) clearTimeout(timer);
  note("keeper stopped");
}

export async function keeperBalance() {
  const b = await publicClient().getBalance({ address: keeper.address });
  return Number(b) / 1e18;
}
