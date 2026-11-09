// Launch a token on the mainnet v4 deployment, then buy and sell once through the router as a check.
//   NAME=Elysium SYMBOL=ELYSIUM META=ipfs://... DEV_BUY=0.2 hardhat run scripts/launch-v4.js --network elysiumMainnet
const fs = require("fs"), path = require("path");
const { ethers } = require("hardhat");
async function retry(f, n = 8) { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n) throw e; console.log("  retry:", (e.shortMessage || e.message).slice(0, 80)); await new Promise((r) => setTimeout(r, 3000)); } } }
async function main() {
  const [s] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnetV4.json"))).contracts;
  const lp = await ethers.getContractAt("ZephraV4Launchpad", d.ZephraV4Launchpad);
  const router = await ethers.getContractAt("ZephraRouter", d.ZephraRouter);
  const q = await ethers.getContractAt("ZephraQuoter", d.ZephraQuoter);
  const cfg = await ethers.getContractAt("ZephraConfig", d.ZephraConfig);
  const fee = await cfg.creationFee();
  const dev = ethers.parseEther(process.env.DEV_BUY || "0.1");
  console.log("gradTarget", ethers.formatEther(await cfg.gradTarget()), "creationFee", ethers.formatEther(fee));
  const tx = await retry(() => lp.createAdvanced(process.env.NAME || "Elysium", process.env.SYMBOL || "ELYSIUM", process.env.META || "", "", [0, 0, 3, 0], 0, { value: fee + dev }));
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
  const token = ev.args.token;
  console.log("token", token, "tx", tx.hash);
  const t = await ethers.getContractAt("ZephraTokenV4", token);
  console.log("code bytes", (await ethers.provider.getCode(token)).length / 2 - 1, "owner", await t.owner(), "contractURI", await t.contractURI());
  const dl = Math.floor(Date.now() / 1000) + 600;
  const b0 = await t.balanceOf(s.address);
  const buy = await retry(() => router.buy(token, 0, dl, { value: ethers.parseEther("0.02") }));
  await buy.wait();
  const got = (await t.balanceOf(s.address)) - b0;
  console.log("router buy ok, tokens", ethers.formatEther(got), "buy tx", buy.hash);
  await (await retry(() => t.approve(d.ZephraRouter, got))).wait();
  const sell = await retry(() => router.sell(token, got, 0, dl));
  await sell.wait();
  console.log("router sell ok, tx", sell.hash, "tokens left", ethers.formatEther(await t.balanceOf(s.address)));
  const i = await lp.info(token);
  console.log("netQuote", ethers.formatEther(i.netQuote), "state", i.state.toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
