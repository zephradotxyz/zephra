// Deploy Zephra to any network configured in hardhat.config.js.
//   npx hardhat run scripts/deploy.js --network elysiumTestnet
// Reads contracts/.env (see .env.example). Writes deployments/<net>.json, app/.env.production
// and keeper/.env (keeper key left for you to fill in).
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

const MAINNET_IDS = [99901];

async function mainnetGuard(deployer) {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = network.name === "elysiumMainnet" || MAINNET_IDS.includes(chainId) && !["localhost", "hardhat"].includes(network.name);
  if (!isMainnet) return;
  const fail = (m) => { console.error(`\n✗ Mainnet guard: ${m}\n`); process.exit(1); };
  if (process.env.CONFIRM_MAINNET !== "yes") fail("set CONFIRM_MAINNET=yes in contracts/.env to deploy with real funds.");
  for (const k of ["ADMIN", "GUARDIAN", "TREASURY", "GRAD_TARGET", "CREATION_FEE"]) if (!process.env[k]) fail(`${k} must be set explicitly for mainnet.`);
  const expected = Number(process.env.ELYSIUM_MAINNET_CHAIN_ID || 99901);
  if (chainId !== expected) fail(`RPC reports chain ${chainId}, expected ${expected}. Wrong RPC?`);
  const bal = await ethers.provider.getBalance(deployer.address);
  if (bal < ethers.parseEther("0.02")) fail(`deployer ${deployer.address} has ${ethers.formatEther(bal)} HYPE; need ≥ 0.02 for gas.`);
  if (process.env.ADMIN.toLowerCase() === deployer.address.toLowerCase()) console.warn("⚠  ADMIN is the deployer hot key. A multisig (e.g. Safe) is strongly recommended.");
  if (process.env.ADMIN.toLowerCase() === process.env.GUARDIAN.toLowerCase()) console.warn("⚠  ADMIN and GUARDIAN are the same address.");
  console.log(`\nMAINNET DEPLOY · chain ${chainId}\n  deployer ${deployer.address} (${ethers.formatEther(bal)} HYPE)\n  admin    ${process.env.ADMIN}\n  guardian ${process.env.GUARDIAN}\n  treasury ${process.env.TREASURY}\n  G        ${process.env.GRAD_TARGET} HYPE · creation fee ${process.env.CREATION_FEE} HYPE\nStarting in 10 s — Ctrl+C to abort.`);
  await new Promise((r) => setTimeout(r, 10_000));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  await mainnetGuard(deployer);
  const admin = process.env.ADMIN || deployer.address;
  const guardian = process.env.GUARDIAN || deployer.address;
  const treasury = process.env.TREASURY || deployer.address;
  const G = ethers.parseEther(process.env.GRAD_TARGET || "1000");
  const fee = ethers.parseEther(process.env.CREATION_FEE || "0.5");

  console.log(`Network ${network.name} · deployer ${deployer.address}`);
  // Resumable, nonce-pinned sends: public RPCs sometimes time out AFTER accepting a transaction.
  // Every step is tied to a fixed nonce, so re-running never deploys a contract twice.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const startNonce = process.env.DEPLOY_START_NONCE !== undefined ? Number(process.env.DEPLOY_START_NONCE) : base;
  let step = 0;
  async function robust(label, txRequest, expectCode) {
    const nonce = startNonce + step++;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const mined = await ethers.provider.getTransactionCount(deployer.address, "latest");
        if (mined > nonce) break; // already included
        const pending = await ethers.provider.getTransactionCount(deployer.address, "pending");
        if (pending <= nonce) await deployer.sendTransaction({ ...txRequest, nonce });
        await sleep(2000);
      } catch (e) {
        console.log(`  ${label}: RPC hiccup (${(e.shortMessage || e.message || "").slice(0, 80)}), retrying…`);
        await sleep(3000);
      }
    }
    for (let i = 0; i < 60 && (await ethers.provider.getTransactionCount(deployer.address, "latest")) <= nonce; i++) await sleep(2000);
    if ((await ethers.provider.getTransactionCount(deployer.address, "latest")) <= nonce) throw new Error(`${label} was not included`);
    if (expectCode) {
      const addr = ethers.getCreateAddress({ from: deployer.address, nonce });
      let code = "0x";
      for (let i = 0; i < 30 && code === "0x"; i++) { try { code = await ethers.provider.getCode(addr); } catch { /* retry */ } if (code === "0x") await sleep(2000); }
      if (code === "0x") throw new Error(`${label}: no contract code at ${addr}`);
      console.log(`  ${label} ${addr}`);
      return addr;
    }
    console.log(`  ${label} done`);
  }
  const create = async (name, args) => {
    const f = await ethers.getContractFactory(name);
    return robust(name, await f.getDeployTransaction(...args), true);
  };
  const configAddr = await create("ZephraConfig", [admin, guardian, treasury, G, fee]);
  const pfAddr = await create("PoolFactory", [configAddr]);
  const mfAddr = await create("MarketFactory", [configAddr]);
  const lpAddr = await create("ZephraLaunchpad", [configAddr, pfAddr, mfAddr]);
  const setLp = async (addr, label) => {
    const c = new ethers.Contract(addr, ["function setLaunchpad(address)"], deployer);
    await robust(label, await c.setLaunchpad.populateTransaction(lpAddr), false);
  };
  await setLp(pfAddr, "PoolFactory.setLaunchpad");
  await setLp(mfAddr, "MarketFactory.setLaunchpad");
  const config = { getAddress: async () => configAddr }, pf = { getAddress: async () => pfAddr }, mf = { getAddress: async () => mfAddr }, lp = { getAddress: async () => lpAddr };

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
    contracts: {
      ZephraConfig: await config.getAddress(),
      PoolFactory: await pf.getAddress(),
      MarketFactory: await mf.getAddress(),
      ZephraLaunchpad: await lp.getAddress(),
    },
    params: { gradTarget: G.toString(), creationFee: fee.toString(), admin, guardian, treasury },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));

  // ABIs for the keeper and frontend
  const abiOut = {};
  for (const n of ["ZephraConfig", "ZephraLaunchpad", "ZephraPool", "PerpMarket", "ZephraToken"]) {
    abiOut[n] = (await artifacts.readArtifact(n)).abi;
  }
  for (const target of [path.join(__dirname, "..", "..", "keeper", "abi.json"), path.join(__dirname, "..", "..", "app", "src", "chain", "abi.json")]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(abiOut));
  }

  // Ready-to-use env files for the frontend and keeper
  const root = path.join(__dirname, "..", "..");
  const rpc = network.config.url || "";
  const isMainnet = out.chainId === 99901 || network.name === "elysiumMainnet";
  const appEnv = [
    `VITE_NETWORK=${isMainnet ? "mainnet" : "testnet"}`,
    `VITE_CHAIN_ID=${out.chainId}`,
    `VITE_LAUNCHPAD=${out.contracts.ZephraLaunchpad}`,
    `VITE_CONFIG=${out.contracts.ZephraConfig}`,
    `VITE_FROM_BLOCK=${out.blockNumber}`,
    rpc ? `VITE_RPC=${rpc}` : "",
    process.env.EXPLORER_URL ? `VITE_EXPLORER=${process.env.EXPLORER_URL}` : "",
    // keeper/API public URL (IPFS uploads for logos + metadata). Same origin via Caddy by default.
    `VITE_API_URL=${process.env.PUBLIC_API_URL || "/keeper"}`,
    `VITE_IPFS_GATEWAY=${process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs/"}`,
  ].filter(Boolean).join("\n") + "\n";
  fs.writeFileSync(path.join(root, "app", ".env.production"), appEnv);

  // keeper/.env: keep secrets you already filled in (KEEPER_PK, PINATA_JWT, …), refresh the rest
  const keeperFile = path.join(root, "keeper", ".env");
  const prev = {};
  if (fs.existsSync(keeperFile)) for (const l of fs.readFileSync(keeperFile, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) prev[m[1]] = m[2]; }
  const kv = {
    RPC_URL: rpc,
    KEEPER_PK: prev.KEEPER_PK || "",
    DEPLOYMENT: `../contracts/deployments/${network.name}.json`,
    POLL_MS: prev.POLL_MS || "5000",
    PORT: prev.PORT || "8787",
    IPFS_PROVIDER: prev.IPFS_PROVIDER || (isMainnet ? "pinata" : "local"),
    PINATA_JWT: prev.PINATA_JWT || "",
    IPFS_GATEWAY: prev.IPFS_GATEWAY || process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs/",
    CORS_ORIGIN: prev.CORS_ORIGIN || "*",
  };
  fs.writeFileSync(keeperFile, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  const todo = [!kv.KEEPER_PK && "KEEPER_PK", kv.IPFS_PROVIDER === "pinata" && !kv.PINATA_JWT && "PINATA_JWT"].filter(Boolean);
  console.log(JSON.stringify(out.contracts, null, 2));
  console.log("Wrote app/.env.production and keeper/.env" + (todo.length ? ` (fill in ${todo.join(", ")})` : ""));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
