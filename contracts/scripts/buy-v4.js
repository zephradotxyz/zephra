// Buy a token through the router. TOKEN=0x.. AMOUNT=0.05 hardhat run scripts/buy-v4.js --network elysiumMainnet
const fs = require("fs"), path = require("path");
const { ethers } = require("hardhat");
async function retry(f, n = 8) { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n) throw e; console.log("  retry:", (e.shortMessage || e.message).slice(0, 80)); await new Promise((r) => setTimeout(r, 3000)); } } }
async function main() {
  const [s] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnetV4.json"))).contracts;
  const router = await ethers.getContractAt("ZephraRouter", d.ZephraRouter);
  const t = await ethers.getContractAt("ZephraTokenV4", process.env.TOKEN);
  const dl = Math.floor(Date.now() / 1000) + 600;
  const tx = await retry(() => router.buy(process.env.TOKEN, 0, dl, { value: ethers.parseEther(process.env.AMOUNT || "0.05") }));
  await tx.wait();
  console.log("buy ok tx", tx.hash, "tokens", ethers.formatEther(await t.balanceOf(s.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
