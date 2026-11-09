// Local scenario for testing the keeper: a token graduates, a long is opened, the price is dumped.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const E = (n) => ethers.parseEther(String(n));
const inc = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "localhost.json")));
  const [, , , creator, alice, bob, carol] = await ethers.getSigners();
  const lp = await ethers.getContractAt("ZephraLaunchpad", dep.contracts.ZephraLaunchpad);
  const fee = await (await ethers.getContractAt("ZephraConfig", dep.contracts.ZephraConfig)).creationFee();
  const rc = await (await lp.connect(creator).create("Keeper Test", "KEEP", 0, { value: fee })).wait();
  const token = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "TokenCreated").args.token;
  await inc(120);
  await lp.connect(bob).buy(token, 0, { value: E(70) });
  await lp.connect(carol).buy(token, 0, { value: E(70) });
  const c = await lp.curves(token);
  const market = await ethers.getContractAt("PerpMarket", c.market);
  const pool = await ethers.getContractAt("ZephraPool", c.pool);
  for (let i = 0; i < 38; i++) { await inc(50); await market.poke(); }
  await market.connect(alice).open(true, E(1), { value: E(0.51) });
  // LP requests a withdrawal (the keeper executes it after the cooldown)
  await market.connect(alice).deposit({ value: E(5) });
  await market.connect(alice).requestWithdraw(await market.shares(alice.address));
  // dump
  const ktok = await ethers.getContractAt("ZephraToken", token);
  const bal = await ktok.balanceOf(bob.address);
  await ktok.connect(bob).approve(c.pool, bal);
  await pool.connect(bob).sell(bal, 0, (await ethers.provider.getBlock("latest")).timestamp + 999);
  for (let i = 0; i < 74; i++) { await inc(50); await market.poke(); }
  console.log(JSON.stringify({ token, market: c.market, liquidatable: await market.isLiquidatable(alice.address, true) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
