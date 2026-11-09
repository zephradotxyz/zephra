// End-to-end smoke test against a deployed Zephra (local node, fork, testnet or mainnet).
// Every step checks real balances; any failure exits non-zero.
//
//   local / fork (time is fast-forwarded):  npx hardhat run scripts/smoke.js --network localhost
//   testnet:                                npx hardhat run scripts/smoke.js --network elysiumTestnet
//   mainnet (small G only!):                SMOKE_MAINNET=yes npx hardhat run scripts/smoke.js --network elysiumMainnet
//
// Covers: launch with dev buy + IPFS-style metadata · curve buy/sell · graduation (pool + market + vault)
// · vault deposit · perps long + short + close · spot buy/sell · creator curve fees · creator spot fees
// · vault withdraw (1 h cooldown) · dev vesting claim · failed launch → sell-only · creator fee splits.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const f = (x) => Number(ethers.formatEther(x)).toFixed(4);
const local = ["localhost", "hardhat"].includes(network.name);
const ok = (m) => console.log(`✓ ${m}`);
const must = (cond, m) => { if (!cond) throw new Error(`check failed: ${m}`); };
const evArgs = (c, rc, name) => rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === name)?.args;

async function step(seconds, markets) {
  // advance local time in ≤ 50 s steps with heartbeats, so no market enters the grace period
  for (let left = seconds; left > 0; left -= 50) {
    await ethers.provider.send("evm_increaseTime", [Math.min(50, left)]);
    await ethers.provider.send("evm_mine", []);
    for (const m of markets) await (await m.poke()).wait();
  }
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`)));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (!local && chainId === 99901 && process.env.SMOKE_MAINNET !== "yes") throw new Error("Refusing to run on mainnet without SMOKE_MAINNET=yes (it spends real HYPE: about G × 1.6).");
  const [creator, maybeTrader, maybeSplit] = await ethers.getSigners();
  const splitTo = maybeSplit ? maybeSplit.address : ethers.Wallet.createRandom().address; // 2nd fee recipient
  const lp = await ethers.getContractAt("ZephraLaunchpad", dep.contracts.ZephraLaunchpad);
  const cfg = await ethers.getContractAt("ZephraConfig", dep.contracts.ZephraConfig);
  const G = await cfg.gradTarget();
  const fee = await cfg.creationFee();
  console.log(`Network ${network.name} (chain ${chainId}) · G ${f(G)} HYPE · creation fee ${f(fee)} · creator ${creator.address}`);

  let trader = maybeTrader;
  if (!trader) {
    trader = ethers.Wallet.createRandom().connect(ethers.provider);
    const amt = (G * 45n) / 100n;
    await (await creator.sendTransaction({ to: trader.address, value: amt })).wait();
    ok(`funded temporary trader ${trader.address} with ${f(amt)} HYPE`);
  }

  // 1 · launch with a dev buy (2% of G) and an ipfs:// metadata URI, tax off
  const devBuy = (G * 2n) / 100n;
  const meta = "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy"; // any CID; the contract only stores the string
  const rc1 = await (await lp.createAdvanced("Smoke Test", "SMOKE", meta, "", { taxWindow: 0, startTaxBps: 10000, perpMaxLeverage: 3, creatorTaxBps: 0 }, 0, { value: fee + devBuy })).wait();
  const token = evArgs(lp, rc1, "TokenCreated").token;
  must((await lp.metadata(token)) === meta, "metadata stored on-chain");
  const c1 = await lp.curves(token);
  ok(`launched SMOKE ${token} · metadata ${meta.slice(0, 22)}… · dev tokens locked`);
  await (await lp.setFeeSplits(token, [creator.address, splitTo], [6000, 4000])).wait();
  ok(`fee splits set: 60% creator · 40% ${splitTo.slice(0, 10)}…`);
  const bal = (a) => ethers.provider.getBalance(a);

  // a second token that will fail (local only: needs a 7-day time jump)
  let failTok;
  if (local) {
    const rcF = await (await lp.createAdvanced("Fail Test", "FAIL", "", "", { taxWindow: 0, startTaxBps: 10000, perpMaxLeverage: 2, creatorTaxBps: 0 }, 0, { value: fee })).wait();
    failTok = evArgs(lp, rcF, "TokenCreated").token;
    await (await lp.connect(trader).buy(failTok, 0, { value: G / 20n })).wait();
    ok(`launched FAIL ${failTok} and bought ${f(G / 20n)} HYPE of it`);
  }

  // 2 · curve buy + partial sell
  const tok = await ethers.getContractAt("ZephraToken", token);
  await (await lp.connect(trader).buy(token, 0, { value: G / 10n })).wait();
  const got = await tok.balanceOf(trader.address);
  await (await tok.connect(trader).approve(dep.contracts.ZephraLaunchpad, got / 4n)).wait();
  await (await lp.connect(trader).sell(token, got / 4n, 0)).wait();
  ok(`curve buy ${f(G / 10n)} HYPE → ${f(got)} SMOKE, sold 25% back`);

  // 3 · buy to graduation
  const rc2 = await (await lp.connect(trader).buy(token, 0, { value: (G * 115n) / 100n })).wait();
  const grad = evArgs(lp, rc2, "Graduated");
  must(grad, "graduated");
  const mkt = await ethers.getContractAt("PerpMarket", grad.market);
  const pool = await ethers.getContractAt("ZephraPool", grad.pool);
  ok(`graduated → pool ${grad.pool} · market ${grad.market} · vault NAV ${f(await mkt.nav())} HYPE`);

  // 4 · curve fees → fee splits; the TRADER triggers the claim (anyone can)
  const claimable = (await lp.curves(token)).creatorClaimable ?? 0n;
  must(claimable > 0n, "curve fees accrued for the creator");
  {
    const c0 = await bal(creator.address), s0 = await bal(splitTo);
    await (await lp.connect(trader).claimCreator(token)).wait();
    const part = (claimable * 6000n) / 10000n;
    must((await bal(creator.address)) - c0 === part, "creator got 60% of curve fees");
    must((await bal(splitTo)) - s0 === claimable - part, "split recipient got 40% of curve fees");
    ok(`curve fees ${f(claimable)} HYPE claimed by a third party → 60/40 to the fee splits`);
  }

  // 5 · vault deposit
  await (await mkt.connect(trader).deposit({ value: G / 5n })).wait();
  const shares = await mkt.shares(trader.address);
  must(shares > 0n, "vault shares minted");
  ok(`vault deposit ${f(G / 5n)} HYPE → ${f(shares)} shares`);

  // 6 · perps (after the 30-min warm-up)
  if (Number(await mkt.state()) === 0) {
    if (!local) console.log("… perps open after the 30-minute warm-up — re-run later for long/short");
    else await step(31 * 60 + 200, [mkt]);
  }
  if (Number(await mkt.state()) === 1) {
    const notional = ((await mkt.capPerSide()) * 18n) / 100n;
    const margin = notional / 2n + (notional * 50n) / 10000n + 1n;
    await (await mkt.connect(trader).open(true, notional, { value: margin })).wait();
    await (await mkt.connect(trader).open(false, notional, { value: margin })).wait();
    ok(`long + short opened · ${f(notional)} HYPE notional each at 2x`);
    if (local) await step(120, [mkt]);
    const b0 = await ethers.provider.getBalance(trader.address);
    await (await mkt.connect(trader).close(true)).wait();
    await (await mkt.connect(trader).close(false)).wait();
    must((await ethers.provider.getBalance(trader.address)) > b0 - ethers.parseEther("0.01"), "closes paid out");
    ok("both positions closed and paid out");
  }

  // 7 · spot trading → creator spot fees (1% of volume)
  const deadline = Math.floor(Date.now() / 1000) + 30 * 86400;
  const fees0 = await pool.creatorFees();
  await (await pool.connect(trader).buy(0, deadline, { value: G / 20n })).wait();
  const spotBal = await tok.balanceOf(trader.address);
  await (await tok.connect(trader).approve(grad.pool, spotBal)).wait();
  await (await pool.connect(trader).sell(spotBal / 2n, 0, deadline)).wait();
  const fees1 = await pool.creatorFees();
  must(fees1 > fees0, "spot creator fees accrued");
  {
    const c0 = await bal(creator.address), s0 = await bal(splitTo);
    await (await pool.connect(trader).claimCreator()).wait();
    const part = (fees1 * 6000n) / 10000n;
    must((await bal(creator.address)) - c0 === part && (await bal(splitTo)) - s0 === fees1 - part, "spot fees split 60/40");
    ok(`spot buy + sell · ${f(fees1)} HYPE of creator spot fees paid 60/40 to the fee splits`);
  }

  // 8 · vault withdrawal: request → 1 h cooldown → execute
  await (await mkt.connect(trader).requestWithdraw(shares / 2n)).wait();
  if (local) {
    await step(3600 + 60, [mkt]);
    const before = await ethers.provider.getBalance(trader.address);
    await (await mkt.connect(creator).executeWithdraw(trader.address)).wait(); // anyone (keeper) can execute
    const paid = (await ethers.provider.getBalance(trader.address)) - before;
    must(paid > 0n && (await mkt.shares(trader.address)) < shares, "withdrawal paid at NAV");
    ok(`vault withdrawal executed after cooldown · paid ${f(paid)} HYPE`);
  } else ok("vault withdrawal requested (the keeper executes it after the 1 h cooldown)");

  // 9 · dev vesting (3 days after graduation) + failed launch (7 days) — local only
  if (local) {
    await ethers.provider.send("evm_increaseTime", [8 * 86400]);
    await ethers.provider.send("evm_mine", []);
    const before = await tok.balanceOf(creator.address);
    await (await lp.claimDev(token)).wait();
    const devGot = (await tok.balanceOf(creator.address)) - before;
    must(devGot > 0n && devGot === c1.devLocked, "all dev tokens vested and claimed");
    ok(`dev buy fully vested · creator claimed ${f(devGot)} SMOKE`);

    await (await lp.markFailed(failTok)).wait();
    const ft = await ethers.getContractAt("ZephraToken", failTok);
    const fb = await ft.balanceOf(trader.address);
    await (await ft.connect(trader).approve(dep.contracts.ZephraLaunchpad, fb)).wait();
    const hb = await ethers.provider.getBalance(trader.address);
    await (await lp.connect(trader).sell(failTok, fb, 0)).wait();
    must((await ethers.provider.getBalance(trader.address)) > hb, "failed curve still buys back");
    ok("FAIL marked failed after 7 days · holder sold back to the curve");
  }

  console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => { console.error("✗", e.shortMessage || e.message || e); process.exit(1); });
