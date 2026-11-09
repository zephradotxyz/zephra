// Read-only post-deploy check. Spends no gas.
//   npx hardhat run scripts/verify-deployment.js --network elysiumMainnet
// Optional: KEEPER_URL=https://zephra.xyz/keeper to also check the keeper/API.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failed++; console.log(`  ✗ ${m}`); };
const check = (cond, m) => (cond ? pass(m) : fail(m));

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment file at ${file}`);
  const d = JSON.parse(fs.readFileSync(file));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Verifying ${network.name} (chain ${chainId})`);

  console.log("Network");
  check(chainId === d.chainId, `RPC chain ${chainId} matches deployment chain ${d.chainId}`);
  const head = await ethers.provider.getBlock("latest");
  check(Date.now() / 1000 - Number(head.timestamp) < 120, `latest block #${head.number} is fresh (${Math.round(Date.now() / 1000 - Number(head.timestamp))} s old)`);

  console.log("Contracts");
  for (const [name, addr] of Object.entries(d.contracts)) check((await ethers.provider.getCode(addr)).length > 2, `${name} has code at ${addr}`);

  const cfg = await ethers.getContractAt("ZephraConfig", d.contracts.ZephraConfig);
  const lp = await ethers.getContractAt("ZephraLaunchpad", d.contracts.ZephraLaunchpad);
  const pf = await ethers.getContractAt("PoolFactory", d.contracts.PoolFactory);
  const mf = await ethers.getContractAt("MarketFactory", d.contracts.MarketFactory);

  console.log("Wiring");
  check((await pf.launchpad()).toLowerCase() === d.contracts.ZephraLaunchpad.toLowerCase(), "PoolFactory → launchpad");
  check((await mf.launchpad()).toLowerCase() === d.contracts.ZephraLaunchpad.toLowerCase(), "MarketFactory → launchpad");

  console.log("Parameters & roles");
  const G = await cfg.gradTarget(), fee = await cfg.creationFee();
  check(G.toString() === d.params.gradTarget, `graduation target ${ethers.formatEther(G)} HYPE`);
  check(fee.toString() === d.params.creationFee, `creation fee ${ethers.formatEther(fee)} HYPE`);
  const roles = { admin: await cfg.admin(), guardian: await cfg.guardian(), treasury: await cfg.treasury() };
  for (const [k, v] of Object.entries(roles)) check(v.toLowerCase() === String(d.params[k]).toLowerCase(), `${k} ${v}`);
  for (const [k, v] of Object.entries(roles)) if ((await ethers.provider.getCode(v)).length <= 2 && chainId === 99901) console.log(`  ⚠ ${k} is an EOA. A multisig is recommended on mainnet.`);
  check(!(await cfg.launchPaused()) && !(await cfg.perpOpenPaused()), "launches and perp opens are not paused");

  if (process.env.KEEPER_URL) {
    console.log("Keeper / API");
    try {
      const h = await (await fetch(`${process.env.KEEPER_URL.replace(/\/$/, "")}/health`)).json();
      check(h.ok === true, `keeper ${h.keeper} healthy · pokes ${h.stats?.pokes}`);
      check(Number(h.chainId) === chainId, `keeper on chain ${h.chainId}`);
      check(h.ipfs?.configured === true, `IPFS ${h.ipfs?.provider} configured`);
      const kb = await ethers.provider.getBalance(h.keeper);
      check(kb >= ethers.parseEther("0.1"), `keeper balance ${ethers.formatEther(kb)} HYPE (≥ 0.1)`);
    } catch (e) {
      fail(`keeper unreachable: ${e.message}`);
    }
  }

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
