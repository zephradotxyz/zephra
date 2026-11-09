// Zephra keeper + indexer API
// - Heartbeat (poke) every market so the grace period never triggers without reason
// - Liquidate positions whose equity is below 10% of notional
// - Force-close positions that hit the 2/3-of-notional profit cap
// - Execute LP withdrawals whose cooldown has ended
// - checkStatus (close-only / closed), settle positions after Closed
// - graduate tokens that crossed the target, flush perp-vault fees (Uniswap v4 hook)
// - Small HTTP API: GET /health, /tokens, /tokens/:addr
// - IPFS: POST /ipfs/launch (logo + metadata → ipfs://CID), GET /ipfs/:cid (cached gateway)
//
// Env (keeper/.env or real env): RPC_URL, KEEPER_PK, DEPLOYMENT (path json), POLL_MS (default 5000), PORT (default 8787)
//   + IPFS_PROVIDER, PINATA_JWT, IPFS_GATEWAY, DATA_DIR, CORS_ORIGIN (see ipfs.mjs)
import "./env.mjs"; // must stay first: loads keeper/.env before other modules read process.env
import fs from "node:fs";
import http from "node:http";
import * as ipfs from "./ipfs.mjs";
import { createPublicClient, createWalletClient, http as httpT, fallback, defineChain, formatEther, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";


const abi = JSON.parse(fs.readFileSync(new URL("./abi.json", import.meta.url)));
// DEPLOYMENT may be absolute or relative to the keeper folder
const depPath = process.env.DEPLOYMENT ? new URL(process.env.DEPLOYMENT, new URL("./", import.meta.url)) : new URL("../contracts/deployments/elysiumMainnetV4.json", import.meta.url);
if (!fs.existsSync(depPath)) {
  // No deployment file yet: stay up (so the host's health check passes) but do nothing on-chain.
  const PORT0 = Number(process.env.PORT || 8787);
  console.log(`No deployment file at ${depPath.pathname}. Keeper is idle until a deployment exists.`);
  http.createServer((req, res) => {
    res.statusCode = /health/.test(req.url || "") ? 200 : 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, deployed: false, reason: "no deployment file" }));
  }).listen(PORT0);
  await new Promise(() => {});
}
const dep = JSON.parse(fs.readFileSync(depPath));
// The mainnet keeper key lives in the MAINNET_KEEPER_PK secret; other networks use KEEPER_PK.
const KEEPER_KEY = dep.chainId === 99901 ? process.env.MAINNET_KEEPER_PK : process.env.KEEPER_PK;
if (!KEEPER_KEY) {
  console.error("No keeper key is set (MAINNET_KEEPER_PK for mainnet, KEEPER_PK otherwise).");
  process.exit(1);
}
// RPC_URL may list several endpoints separated by commas; they are tried in order (failover).
const RPCS = (process.env.RPC_URL || "https://testnet-rpc.elysium.kinetiq.xyz").split(",").map((x) => x.trim()).filter(Boolean);
const RPC = RPCS[0];
const transport = () => (RPCS.length > 1 ? fallback(RPCS.map((u) => httpT(u, { timeout: 20_000, retryCount: 1 })), { retryCount: 2 }) : httpT(RPC));
const POLL = Number(process.env.POLL_MS || 5000);
const PORT = Number(process.env.PORT || 8787);
const ONCE = process.env.ONCE === "1";

const chain = defineChain({
  id: dep.chainId,
  name: dep.network,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
});
const account = privateKeyToAccount(KEEPER_KEY.startsWith("0x") ? KEEPER_KEY : `0x${KEEPER_KEY}`);
const pub = createPublicClient({ chain, transport: transport() });
const wallet = createWalletClient({ chain, transport: transport(), account });
const LP = dep.contracts.ZephraV4Launchpad ?? dep.contracts.ZephraLaunchpad;

const ev = {
  TokenCreated: parseAbiItem("event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 devTokens, uint32 taxWindow, uint16 startTaxBps, uint8 perpMaxLeverage, string metadata)"),
  Graduated: parseAbiItem("event Graduated(address indexed token, address pool, address market, uint256 poolHYPE, uint256 poolTokens)"),
  Open: parseAbiItem("event Open(address indexed trader, bool isLong, uint256 margin, uint256 notional, uint256 price)"),
  Close: parseAbiItem("event Close(address indexed trader, bool isLong, uint256 price, int256 pnl, uint256 payout, uint8 kind)"),
  WithdrawRequested: parseAbiItem("event WithdrawRequested(address indexed lp, uint256 shares, uint64 readyAt)"),
};

// ---------------- state (indexer) ----------------
const state = {
  fromBlock: BigInt(dep.blockNumber ?? 0),
  tokens: new Map(), // token -> {token, creator, name, symbol, pool, market}
  positions: new Map(), // market -> Set("trader:isLong")
  lps: new Map(), // market -> Set(lp)
  stats: { liquidations: 0, profitCaps: 0, withdraws: 0, pokes: 0, statusChecks: 0, failed: 0, settles: 0, errors: 0 },
  lastStatusCheck: 0,
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function send(address, contractAbi, functionName, args = []) {
  try {
    const { request } = await pub.simulateContract({ address, abi: contractAbi, functionName, args, account });
    const hash = await wallet.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    return true;
  } catch (e) {
    state.stats.errors++;
    log(`failed ${functionName} @ ${address}:`, e.shortMessage || e.message);
    return false;
  }
}

const read = (address, contractAbi, functionName, args = []) => pub.readContract({ address, abi: contractAbi, functionName, args });

// Event history is read in bounded chunks so a long outage or a large backlog never
// produces one oversized eth_getLogs request that the RPC would reject.
const LOG_CHUNK = 2000n;
async function syncEvents() {
  const latest = await pub.getBlockNumber();
  for (let i = 0; i < 100 && state.fromBlock <= latest; i++) {
    const to = state.fromBlock + LOG_CHUNK - 1n < latest ? state.fromBlock + LOG_CHUNK - 1n : latest;
    await syncRange(state.fromBlock, to);
  }
}

async function syncRange(fromBlock, latest) {
  const range = { fromBlock, toBlock: latest };
  const created = await pub.getLogs({ address: LP, event: ev.TokenCreated, ...range });
  for (const l of created) {
    state.tokens.set(l.args.token, { token: l.args.token, creator: l.args.creator, name: l.args.name, symbol: l.args.symbol });
  }
  const grads = await pub.getLogs({ address: LP, event: ev.Graduated, ...range });
  for (const l of grads) {
    const t = state.tokens.get(l.args.token) ?? { token: l.args.token };
    t.pool = l.args.pool;
    t.market = l.args.market;
    state.tokens.set(l.args.token, t);
    const k = t.market.toLowerCase(); // log.address is always lowercase
    if (!state.positions.has(k)) state.positions.set(k, new Set());
    if (!state.lps.has(k)) state.lps.set(k, new Set());
  }
  const markets = [...state.positions.keys()];
  if (markets.length) {
    for (const l of await pub.getLogs({ address: markets, event: ev.Open, ...range })) state.positions.get(l.address.toLowerCase())?.add(`${l.args.trader}:${l.args.isLong}`);
    for (const l of await pub.getLogs({ address: markets, event: ev.Close, ...range })) state.positions.get(l.address.toLowerCase())?.delete(`${l.args.trader}:${l.args.isLong}`);
    for (const l of await pub.getLogs({ address: markets, event: ev.WithdrawRequested, ...range })) state.lps.get(l.address.toLowerCase())?.add(l.args.lp);
  }
  state.fromBlock = latest + 1n;
}

let lastLowBalanceWarning = 0;
async function guards() {
  const cid = await pub.getChainId();
  if (cid !== dep.chainId) throw new Error(`RPC chain ${cid} does not match deployment chain ${dep.chainId}. Refusing to send transactions.`);
  const bal = await pub.getBalance({ address: account.address });
  state.balance = formatEther(bal);
  if (bal < 100000000000000000n && Date.now() - lastLowBalanceWarning > 60_000) {
    lastLowBalanceWarning = Date.now();
    log(`LOW BALANCE: keeper wallet has ${state.balance} HYPE (< 0.1). Top it up or heartbeats stop.`);
  }
}

async function tick() {
  await guards();
  await syncEvents();
  const now = (await pub.getBlock()).timestamp; // chain time, not the local clock
  const doStatus = Date.now() - state.lastStatusCheck > 60_000 || ONCE;
  if (doStatus) state.lastStatusCheck = Date.now();

  for (const t of state.tokens.values()) {
    if (!t.market) {
      // crossed the graduation target: the next swap would graduate it, but anyone may call graduate()
      if (doStatus) {
        const info = await read(LP, abi.ZephraLaunchpad, "info", [t.token]);
        if (Number(info.state ?? info[1]) === 2 && (await send(LP, abi.ZephraLaunchpad, "graduate", [t.token]))) log(`graduate ${t.symbol}`);
      }
      continue;
    }
    const M = abi.PerpMarket;
    const m = t.market;
    if (doStatus && (await read(LP, abi.ZephraLaunchpad, "vaultOwed", [t.token])) > 0n) {
      if (await send(LP, abi.ZephraLaunchpad, "flushVault", [t.token])) log(`flushVault ${t.symbol}`);
    }
    const mk = m.toLowerCase();
    const st = Number(await read(m, M, "state"));
    // Closed: settle every position
    if (st === 3) {
      for (const key of [...state.positions.get(mk)]) {
        const [trader, isLong] = key.split(":");
        if (await send(m, M, "settle", [trader, isLong === "true"])) state.positions.get(mk).delete(key), state.stats.settles++;
      }
    } else {
      // heartbeat
      const hb = await read(m, M, "lastHeartbeat");
      if (now - hb > 20n && (await send(m, M, "poke"))) state.stats.pokes++;
      // liquidations & profit cap
      for (const key of [...state.positions.get(mk)]) {
        const [trader, isLongS] = key.split(":");
        const isLong = isLongS === "true";
        const pos = await read(m, M, "getPosition", [trader, isLong]);
        if (pos.notional === 0n) {
          state.positions.get(mk).delete(key);
          continue;
        }
        if (await read(m, M, "isLiquidatable", [trader, isLong])) {
          if (await send(m, M, "liquidate", [trader, isLong])) state.stats.liquidations++, log(`liquidated ${t.symbol} ${trader} ${isLong ? "long" : "short"}`);
        } else if (await read(m, M, "atProfitCap", [trader, isLong])) {
          if (await send(m, M, "forceCloseAtCap", [trader, isLong])) state.stats.profitCaps++, log(`profit cap ${t.symbol} ${trader}`);
        }
      }
      if (doStatus && (await send(m, M, "checkStatus"))) state.stats.statusChecks++;
    }
    // withdraw LP
    for (const lp of [...state.lps.get(mk)]) {
      const [shares, readyAt] = await read(m, M, "withdrawReq", [lp]);
      if (shares === 0n) {
        state.lps.get(mk).delete(lp);
        continue;
      }
      if (readyAt <= now && (await read(m, M, "freeLiquidity")) > 0n) {
        if (await send(m, M, "executeWithdraw", [lp])) state.stats.withdraws++, log(`withdraw ${t.symbol} ${lp}`);
      }
    }
  }
}

// ---------------- API ----------------
async function tokenView(t) {
  const c = await read(LP, abi.ZephraLaunchpad, "info", [t.token]);
  const out = { ...t, state: ["none", "bonding", "crossed", "graduated"][Number(c.state ?? c[1])], realHYPE: formatEther(c.netQuote ?? c[6]), tokensSold: formatEther(c.tokensSold ?? c[7]) };
  if (t.market) {
    const M = abi.PerpMarket;
    const [nav, cap, st, longSide, shortSide, price] = await Promise.all([
      read(t.market, M, "nav"),
      read(t.market, M, "capPerSide"),
      read(t.market, M, "state"),
      read(t.market, M, "longSide"),
      read(t.market, M, "shortSide"),
      read(LP, abi.ZephraLaunchpad, "spotPrice", [t.token]),
    ]);
    Object.assign(out, {
      marketState: ["warmup", "active", "closeonly", "closed"][Number(st)],
      nav: formatEther(nav),
      capPerSide: formatEther(cap),
      oiLong: formatEther(longSide[0]),
      oiShort: formatEther(shortSide[0]),
      spotPrice: formatEther(price),
      openPositions: state.positions.get(t.market.toLowerCase())?.size ?? 0,
    });
  }
  return out;
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(ipfs.httpError(413, "request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function serve() {
  const CORS = process.env.CORS_ORIGIN || "*";
  http
    .createServer(async (req, res) => {
      res.setHeader("access-control-allow-origin", CORS);
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("x-content-type-options", "nosniff");
      const json = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
      try {
        const u = new URL(req.url, "http://x");
        let p = u.pathname.replace(/\/+$/, "") || "/";
        // behind a path-routing proxy (e.g. served under /keeper): strip the prefix
        const PREFIX = (process.env.API_PREFIX || "").replace(/\/+$/, "");
        if (PREFIX && (p === PREFIX || p.startsWith(PREFIX + "/"))) p = p.slice(PREFIX.length) || "/";
        if (req.method === "OPTIONS") return (res.statusCode = 204), res.end();
        if (p === "/health" || p === "/healthz") return json(200, { ok: true, keeper: account.address, chainId: chain.id, balance: state.balance, block: String(state.fromBlock - 1n), stats: state.stats, ipfs: ipfs.ipfsInfo() });
        if (p === "/tokens") return json(200, await Promise.all([...state.tokens.values()].map(tokenView)));
        const m = p.match(/^\/tokens\/(0x[0-9a-fA-F]{40})$/);
        if (m) {
          const t = [...state.tokens.values()].find((x) => x.token.toLowerCase() === m[1].toLowerCase());
          if (!t) return json(404, { error: "not found" });
          return json(200, await tokenView(t));
        }
        if (p === "/ipfs/launch" && req.method === "POST") {
          const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
          if (ipfs.rateLimited(ip)) return json(429, { error: "Too many uploads, try again later" });
          const body = JSON.parse((await readBody(req, ipfs.MAX_BODY)).toString() || "{}");
          const out = await ipfs.pinLaunch(body);
          log(`ipfs launch ${out.metadata.symbol} → ${out.metadataURI}`);
          return json(200, out);
        }
        const c = p.match(/^\/ipfs\/([A-Za-z0-9]+)$/);
        if (c && req.method === "GET") {
          if (!ipfs.isCid(c[1])) return json(400, { error: "bad cid" });
          const buf = await ipfs.fetchCid(c[1]);
          const type = ipfs.contentType(buf);
          if (!type) return json(415, { error: "unsupported content" });
          res.setHeader("content-type", type);
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
          res.setHeader("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
          return res.end(buf);
        }
        json(404, { error: "not found" });
      } catch (e) {
        json(e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.shortMessage || e.message });
      }
    })
    .listen(PORT, () => log(`API on http://localhost:${PORT} · IPFS ${ipfs.ipfsInfo().provider}`));
}

log(`Keeper ${account.address} · chain ${chain.id} · launchpad ${LP}`);
if (ONCE) {
  await tick();
  console.log(JSON.stringify({ tokens: state.tokens.size, stats: state.stats }));
  process.exit(0);
}
serve();
for (;;) {
  try {
    await tick();
  } catch (e) {
    state.stats.errors++;
    log("tick error:", e.shortMessage || e.message);
  }
  await new Promise((r) => setTimeout(r, POLL));
}
