// Zephra fork mode: a local copy of Elysium testnet with unlimited HYPE. No faucet needed.
//   npm run fork                      fork Elysium testnet, deploy Zephra, start the keeper
//   npm run fund -- 0xYourAddress     give any wallet 10,000 HYPE on the running fork
// Env (optional): FORK_URL (default Elysium RPC, "none" = blank chain), PORT (8545),
//   PUBLIC_RPC (URL the browser uses to reach this node, e.g. your server https URL),
//   USER_WALLET (comma-separated addresses to fund at start), NO_KEEPER=1,
//   FORK_CHAIN_ID=99901 (rehearse a mainnet build: the app is built in mainnet mode), PUBLIC_API_URL
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 8545);
const LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.FORK_URL || process.env.ELYSIUM_RPC || "https://testnet-rpc.elysium.kinetiq.xyz";
const TEN_K = "0x21E19E0C9BAB2400000"; // 10,000 HYPE in wei
// Hardhat's public test account #1 — only ever used on this local fork.
const KEEPER_PK = require("ethers").HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/1").privateKey;

async function rpc(method, params = [], url = LOCAL) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const fund = (a) => rpc("hardhat_setBalance", [a, TEN_K]);

async function fundCmd() {
  const addrs = process.argv.slice(3).flatMap((a) => a.split(",")).filter(Boolean);
  if (!addrs.length) throw new Error("Usage: npm run fund -- 0xAddress [0xAddress…]");
  for (const a of addrs) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`Not an address: ${a}`);
    await fund(a);
    console.log(`Funded ${a} with 10,000 HYPE`);
  }
}

async function main() {
  if (process.argv[2] === "fund") return fundCmd();

  const forking = FORK_URL !== "none";
  console.log(forking ? `Forking ${FORK_URL} …` : "Starting a blank local chain (FORK_URL=none) …");
  const node = spawn("npx", ["hardhat", "node", "--hostname", "0.0.0.0", "--port", String(PORT)], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ZEPHRA_FORK: "1", FORK_URL },
    stdio: ["ignore", "pipe", "inherit"],
  });
  node.stdout.on("data", () => {}); // hardhat prints every request; keep the console clean
  const stop = () => { node.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  node.on("exit", (c) => { console.error(`hardhat node exited (${c})`); process.exit(1); });

  for (let i = 0; ; i++) {
    try { await rpc("eth_chainId"); break; } catch { if (i > 120) throw new Error("Node did not start. If forking failed, check FORK_URL or run with FORK_URL=none."); await new Promise((r) => setTimeout(r, 1000)); }
  }
  const chainId = parseInt(await rpc("eth_chainId"), 16);
  console.log(`Node up on ${LOCAL} · chain ${chainId}${forking ? ` · forked at block ${parseInt(await rpc("eth_blockNumber"), 16)}` : ""}`);

  // deploy (writes deployments/localhost.json, app/.env.production and keeper/.env)
  execFileSync("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, GRAD_TARGET: process.env.GRAD_TARGET || "10", CREATION_FEE: process.env.CREATION_FEE || "0.01" },
  });

  // point the app at the browser-reachable RPC, and the keeper at the local node
  const appEnv = path.join(ROOT, "app", ".env.production");
  const publicRpc = process.env.PUBLIC_RPC || LOCAL;
  const publicApi = process.env.PUBLIC_API_URL || "http://127.0.0.1:8787";
  let env = fs.readFileSync(appEnv, "utf8").replace(/^VITE_RPC=.*\n?/m, "").replace(/^VITE_API_URL=.*\n?/m, "");
  fs.writeFileSync(appEnv, env + `VITE_RPC=${publicRpc}\nVITE_API_URL=${publicApi}\n`);
  // local IPFS provider: logos + metadata are stored by the keeper API and served from /ipfs/<cid>
  fs.writeFileSync(path.join(ROOT, "keeper", ".env"), `RPC_URL=${LOCAL}\nKEEPER_PK=${KEEPER_PK}\nDEPLOYMENT=../contracts/deployments/localhost.json\nPOLL_MS=5000\nPORT=8787\nIPFS_PROVIDER=local\nCORS_ORIGIN=*\n`);

  const users = (process.env.USER_WALLET || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of users) { await fund(a); console.log(`Funded ${a} with 10,000 HYPE`); }

  if (process.env.NO_KEEPER !== "1") {
    const k = spawn("node", ["index.mjs"], { cwd: path.join(ROOT, "keeper"), stdio: "inherit", env: { ...process.env, RPC_URL: LOCAL, KEEPER_PK, DEPLOYMENT: "../contracts/deployments/localhost.json", IPFS_PROVIDER: "local" } });
    process.on("exit", () => k.kill());
  }

  console.log(`
────────────────────────────────────────────────────────
 Zephra fork is running (chain ${chainId}).
 1. Rebuild the web app so it uses this node:  cd app && npm run build
    (browser RPC = ${publicRpc}${process.env.PUBLIC_RPC ? "" : "  · set PUBLIC_RPC when the app is opened from another machine"})
 2. Open the app → Connect → burner wallet (MetaMask would use its own Elysium RPC).
 3. Give your wallet HYPE:  npm run fund -- 0xYourAddress
 Keeper API: http://127.0.0.1:8787/health      Ctrl+C stops everything.
────────────────────────────────────────────────────────`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
