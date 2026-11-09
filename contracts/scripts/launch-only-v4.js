// Launch one token on the mainnet v4 deployment (no test trades).
//   NAME=.. SYMBOL=.. META=ipfs://.. DEV_BUY=0 hardhat run scripts/launch-only-v4.js --network elysiumMainnet
const fs = require("fs"), path = require("path");
const { ethers } = require("hardhat");
async function retry(f, n = 8) { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n) throw e; console.log("  retry:", (e.shortMessage || e.message).slice(0, 80)); await new Promise((r) => setTimeout(r, 3000)); } } }
async function main() {
  const [s] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnetV4.json"))).contracts;
  const lp = await ethers.getContractAt("ZephraV4Launchpad", d.ZephraV4Launchpad);
  const cfg = await ethers.getContractAt("ZephraConfig", d.ZephraConfig);
  const fee = await cfg.creationFee();
  const dev = ethers.parseEther(process.env.DEV_BUY || "0");
  console.log("creator", s.address, "balance", ethers.formatEther(await ethers.provider.getBalance(s.address)), "fee", ethers.formatEther(fee));
  const tx = await retry(() => lp.createAdvanced(process.env.NAME, process.env.SYMBOL, process.env.META, "", [0, 0, 3, 0], 0, { value: fee + dev }));
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
  console.log("token", ev.args.token, "tx", tx.hash);
}
main().catch((e) => { console.error(e); process.exit(1); });
