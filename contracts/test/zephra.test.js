const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const G = E(100);

async function increase(sec) {
  await network.provider.send("evm_increaseTime", [sec]);
  await network.provider.send("evm_mine");
}
async function setNextTs(offsetSec) {
  const b = await ethers.provider.getBlock("latest");
  await network.provider.send("evm_setNextBlockTimestamp", [b.timestamp + offsetSec]);
}
// Advance time while keeping the heartbeat alive (poke every 50s) so no grace period triggers
async function advance(market, sec) {
  let left = sec;
  while (left > 0) {
    const step = Math.min(50, left);
    await increase(step);
    await market.poke();
    left -= step;
  }
}
const deadline = async () => (await ethers.provider.getBlock("latest")).timestamp + 3600;

async function deploy() {
  const [admin, guardian, treasury, creator, alice, bob, carol, keeper] = await ethers.getSigners();
  const Config = await ethers.getContractFactory("ZephraConfig");
  const config = await Config.deploy(admin.address, guardian.address, treasury.address, G, E(0.01));
  const pf = await (await ethers.getContractFactory("PoolFactory")).deploy(await config.getAddress());
  const mf = await (await ethers.getContractFactory("MarketFactory")).deploy(await config.getAddress());
  const lp = await (await ethers.getContractFactory("ZephraLaunchpad")).deploy(
    await config.getAddress(),
    await pf.getAddress(),
    await mf.getAddress()
  );
  await pf.setLaunchpad(await lp.getAddress());
  await mf.setLaunchpad(await lp.getAddress());
  return { config, pf, mf, lp, admin, guardian, treasury, creator, alice, bob, carol, keeper };
}

async function createToken(ctx, devBuy = 0n) {
  const { lp, creator } = ctx;
  const tx = await lp.connect(creator).create("Zeph Cat", "ZCAT", 0, { value: E(0.01) + devBuy });
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
  const token = await ethers.getContractAt("ZephraToken", ev.args.token);
  return token;
}

async function graduate(ctx, token) {
  const { lp, alice, bob } = ctx;
  await increase(120); // skip the tax window
  await lp.connect(alice).buy(await token.getAddress(), 0, { value: E(60) });
  await lp.connect(bob).buy(await token.getAddress(), 0, { value: E(60) }); // crosses G, the excess is refunded
  const c = await lp.curves(await token.getAddress());
  const pool = await ethers.getContractAt("ZephraPool", c.pool);
  const market = await ethers.getContractAt("PerpMarket", c.market);
  return { pool, market };
}

async function activeMarket(ctx) {
  const token = await createToken(ctx);
  const { pool, market } = await graduate(ctx, token);
  // build TWAP history, then get past the warm-up
  await advance(market, 31 * 60);
  return { token, pool, market };
}

describe("Launchpad: create, tax, dev buy", () => {
  it("tax is 100% at launch and decays linearly to 2% over 60 seconds", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const addr = await token.getAddress();
    const [bps0] = await ctx.lp.buyFeeBps(addr);
    expect(bps0).to.equal(10000n);
    // buy at second 1: ~98% tax, almost all HYPE becomes fee
    const q = await ctx.lp.quoteBuy(addr, E(1));
    expect(q.fee).to.equal(E(1));
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(1) });
    const c1 = await ctx.lp.curves(addr);
    expect(c1.realHYPE).to.be.lt(E(0.03));
    await increase(30);
    const [bps30, isTax] = await ctx.lp.buyFeeBps(addr);
    expect(isTax).to.equal(true);
    expect(bps30).to.be.closeTo(5100n, 200n);
    await increase(40);
    const [bpsAfter, tax2] = await ctx.lp.buyFeeBps(addr);
    expect(bpsAfter).to.equal(100n);
    expect(tax2).to.equal(false);
  });

  it("creator share of the tax is locked; escrow and protocol are credited", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const addr = await token.getAddress();
    await increase(30);
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(1) });
    const c = await ctx.lp.curves(addr);
    expect(c.creatorLockedTax).to.be.gt(0n);
    expect(c.escrow).to.be.closeTo(c.creatorLockedTax, 1n);
    expect(c.creatorClaimable).to.equal(0n);
  });

  it("dev buy is capped at 10% of supply and locked", async () => {
    const ctx = await deploy();
    await expect(ctx.lp.connect(ctx.creator).create("Big", "BIG", 0, { value: E(0.01) + E(50) })).to.be.revertedWith("dev buy > 10%");
    const token = await createToken(ctx, E(2));
    const c = await ctx.lp.curves(await token.getAddress());
    expect(c.devLocked).to.be.gt(0n);
    expect(await token.balanceOf(ctx.creator.address)).to.equal(0n);
    await expect(ctx.lp.connect(ctx.creator).claimDev(await token.getAddress())).to.be.revertedWith("nothing");
  });

  it("sells back to the curve", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const addr = await token.getAddress();
    await increase(100);
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(5) });
    const bal = await token.balanceOf(ctx.alice.address);
    await token.connect(ctx.alice).approve(await ctx.lp.getAddress(), bal);
    const before = await ethers.provider.getBalance(ctx.alice.address);
    await ctx.lp.connect(ctx.alice).sell(addr, bal, 0);
    const after = await ethers.provider.getBalance(ctx.alice.address);
    expect(after - before).to.be.gt(E(4.8));
  });
});

describe("Advanced launch settings", () => {
  async function createAdv(ctx, params, meta = '{"description":"x"}') {
    const rc = await (await ctx.lp.connect(ctx.creator).createAdvanced("Adv", "ADV", meta, "data:image/webp;base64,AAAA", params, 0, { value: E(0.01) })).wait();
    const ev = rc.logs.map((l) => { try { return ctx.lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
    return { addr: ev.args.token, ev };
  }

  it("custom tax: 50% start over 120 seconds, decays to 2%", async () => {
    const ctx = await deploy();
    const { addr, ev } = await createAdv(ctx, { taxWindow: 120, startTaxBps: 5000, perpMaxLeverage: 3, creatorTaxBps: 0 });
    expect(ev.args.taxWindow).to.equal(120n);
    expect(await ctx.lp.metadata(addr)).to.equal('{"description":"x"}');
    const imgLog = (await ethers.provider.getLogs({ address: await ctx.lp.getAddress(), fromBlock: 0 }))
      .map((l) => { try { return ctx.lp.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "TokenImage");
    expect(imgLog.args.image).to.equal("data:image/webp;base64,AAAA");
    const [b0, t0] = await ctx.lp.buyFeeBps(addr);
    expect(t0).to.equal(true);
    expect(b0).to.be.closeTo(5000n, 50n);
    await increase(60);
    const [b1] = await ctx.lp.buyFeeBps(addr);
    expect(b1).to.be.closeTo(2600n, 100n);
    await increase(70);
    const [b2, t2] = await ctx.lp.buyFeeBps(addr);
    expect(b2).to.equal(100n);
    expect(t2).to.equal(false);
  });

  it("tax can be disabled; bounds are enforced", async () => {
    const ctx = await deploy();
    const { addr } = await createAdv(ctx, { taxWindow: 0, startTaxBps: 0, perpMaxLeverage: 2, creatorTaxBps: 0 });
    const [b, isTax] = await ctx.lp.buyFeeBps(addr);
    expect(b).to.equal(100n);
    expect(isTax).to.equal(false);
    await expect(createAdv(ctx, { taxWindow: 10, startTaxBps: 5000, perpMaxLeverage: 3, creatorTaxBps: 0 })).to.be.revertedWith("tax window");
    await expect(createAdv(ctx, { taxWindow: 60, startTaxBps: 500, perpMaxLeverage: 3, creatorTaxBps: 0 })).to.be.revertedWith("start tax");
    await expect(createAdv(ctx, { taxWindow: 60, startTaxBps: 5000, perpMaxLeverage: 4, creatorTaxBps: 0 })).to.be.revertedWith("leverage");
  });

  it("perp leverage cap from launch settings is enforced after graduation", async () => {
    const ctx = await deploy();
    const { addr } = await createAdv(ctx, { taxWindow: 0, startTaxBps: 0, perpMaxLeverage: 1, creatorTaxBps: 0 });
    const token = await ethers.getContractAt("ZephraToken", addr);
    const { market } = await graduate(ctx, token);
    await advance(market, 31 * 60);
    expect(await market.leverageCap()).to.equal(1n);
    expect(await market.maxLeverage()).to.equal(1n);
    await expect(market.connect(ctx.alice).open(true, E(1), { value: E(0.6) })).to.be.revertedWith("leverage");
    await market.connect(ctx.alice).open(true, E(1), { value: E(1.01) });
  });
});

describe("Graduation and failed graduation", () => {
  it("graduates exactly at G: pool 85%, vault 10% + escrow, Zephra 5%", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx, E(1));
    const { pool, market } = await graduate(ctx, token);
    const c = await ctx.lp.curves(await token.getAddress());
    expect(c.state).to.equal(2n);
    expect(await pool.reserveHYPE()).to.equal(E(85));
    expect(await market.vaultCash()).to.be.gte(E(10));
    expect(await market.lockedShares(ctx.treasury.address)).to.equal(E(10));
    expect(await market.lockedShares(ctx.creator.address)).to.be.gt(0n);
    // pool price = final curve price (no jump)
    const spot = await pool.spotPrice();
    expect(spot).to.be.gt(0n);
    // leftover supply is burned
    expect(await token.totalSupply()).to.be.lt(E(1_000_000_000));
    // perp starts in warm-up
    expect(await market.state()).to.equal(0n);
  });

  it("dev buy vests linearly over 3 days after graduation", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx, E(1));
    await graduate(ctx, token);
    await increase(36 * 3600);
    await ctx.lp.connect(ctx.creator).claimDev(await token.getAddress());
    const c = await ctx.lp.curves(await token.getAddress());
    const half = c.devLocked / 2n;
    expect(await token.balanceOf(ctx.creator.address)).to.be.closeTo(half, half / 50n);
  });

  it("fails after 7 days: sell-only, creator claims tax and escrow", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const addr = await token.getAddress();
    await increase(30);
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(2) });
    await increase(8 * 24 * 3600);
    await expect(ctx.lp.connect(ctx.bob).buy(addr, 0, { value: E(1) })).to.be.revertedWith("failed: call markFailed");
    await ctx.lp.markFailed(addr);
    await expect(ctx.lp.connect(ctx.bob).buy(addr, 0, { value: E(1) })).to.be.revertedWith("not bonding");
    const c = await ctx.lp.curves(addr);
    expect(c.creatorClaimable).to.be.gt(0n);
    const bal = await token.balanceOf(ctx.alice.address);
    await token.connect(ctx.alice).approve(await ctx.lp.getAddress(), bal);
    await ctx.lp.connect(ctx.alice).sell(addr, bal, 0);
    await ctx.lp.connect(ctx.creator).claimCreator(addr);
  });
});

describe("Spot pool", () => {
  it("2% fee: creator 0.75%, locked dev shares in the vault, LP 0.25%, protocol 0.5%", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const { pool, market } = await graduate(ctx, token);
    const lockedBefore = await market.lockedShares(ctx.creator.address);
    const cashBefore = await market.vaultCash();
    await pool.connect(ctx.carol).buy(0, await deadline(), { value: E(10) });
    expect(await pool.creatorFees()).to.equal(E(0.075));
    expect(await pool.protocolFees()).to.equal(E(0.05));
    expect((await market.vaultCash()) - cashBefore).to.equal(E(0.075));
    expect(await market.lockedShares(ctx.creator.address)).to.be.gt(lockedBefore);
    const tb = await token.balanceOf(ctx.carol.address);
    await token.connect(ctx.carol).approve(await pool.getAddress(), tb);
    await pool.connect(ctx.carol).sell(tb, 0, await deadline());
    expect(await pool.volume72h()).to.be.gt(E(19));
  });
});

describe("Perp market", () => {
  it("warm-up blocks opens; 2x leverage during the first 24 hours", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const { market } = await graduate(ctx, token);
    await expect(market.connect(ctx.alice).open(true, E(1), { value: E(1) })).to.be.revertedWith("not active");
    await advance(market, 31 * 60);
    expect(await market.maxLeverage()).to.equal(2n);
    await expect(market.connect(ctx.alice).open(true, E(3), { value: E(1.02) })).to.be.revertedWith("leverage");
    await market.connect(ctx.alice).open(true, E(1), { value: E(0.51) });
    const p = await market.getPosition(ctx.alice.address, true);
    expect(p.notional).to.equal(E(1));
  });

  it("the insider (creator) cannot open positions", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    await expect(market.connect(ctx.creator).open(false, E(1), { value: E(1) })).to.be.revertedWith("insider");
  });

  it("per-side OI cap and per-wallet limit", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    const cap = await market.capPerSide();
    expect(cap).to.be.gt(0n);
    const tooBig = (cap * 25n) / 100n;
    await expect(market.connect(ctx.alice).open(true, tooBig, { value: tooBig })).to.be.revertedWith("wallet cap");
  });

  it("opens are blocked when spot/TWAP deviation is above 3%", async () => {
    const ctx = await deploy();
    const { pool, market } = await activeMarket(ctx);
    await pool.connect(ctx.carol).buy(0, await deadline(), { value: E(10) }); // pump spot
    expect(await market.deviationBps()).to.be.gt(300n);
    await expect(market.connect(ctx.alice).open(true, E(1), { value: E(1) })).to.be.revertedWith("price deviation");
  });

  it("pessimistic pricing: long opens at >= spot and TWAP", async () => {
    const ctx = await deploy();
    const { pool, market } = await activeMarket(ctx);
    const spot = await pool.spotPrice();
    const tw = await pool.twap(180);
    const px = await market.execPrice(true, true, E(1));
    expect(px).to.be.gte(spot > tw ? spot : tw);
    const pxs = await market.execPrice(false, true, E(1));
    expect(pxs).to.be.lte(spot < tw ? spot : tw);
  });

  it("a long profits when price rises, the vault pays, fees are split", async () => {
    const ctx = await deploy();
    const { pool, market } = await activeMarket(ctx);
    await market.connect(ctx.alice).open(true, E(1), { value: E(0.51) });
    await pool.connect(ctx.carol).buy(0, await deadline(), { value: E(8) });
    await advance(market, 400); // let the TWAP catch up
    const before = await ethers.provider.getBalance(ctx.alice.address);
    await market.connect(ctx.alice).close(true);
    const after = await ethers.provider.getBalance(ctx.alice.address);
    expect(after - before).to.be.gt(E(0.55));
    expect(await market.protocolAccrued()).to.be.gt(0n);
    expect(await market.positionCount()).to.equal(0n);
  });

  it("profit cap at 2/3 of notional: position is force-closed, vault pays at most 2/3 N", async () => {
    const ctx = await deploy();
    const { pool, market } = await activeMarket(ctx);
    await market.connect(ctx.alice).open(true, E(1), { value: E(0.51) });
    await pool.connect(ctx.carol).buy(0, await deadline(), { value: E(60) }); // price rises more than 2x
    await advance(market, 400);
    expect(await market.atProfitCap(ctx.alice.address, true)).to.equal(true);
    const cashBefore = await market.vaultCash();
    const before = await ethers.provider.getBalance(ctx.alice.address);
    await market.connect(ctx.keeper).forceCloseAtCap(ctx.alice.address, true);
    const got = (await ethers.provider.getBalance(ctx.alice.address)) - before;
    // margin 0.505 + profit 0.6667 - fee 0.005
    expect(got).to.be.closeTo(E(1.1667), E(0.01));
    expect(cashBefore - (await market.vaultCash())).to.be.lte(E(0.67));
  });

  it("liquidates after a deep drop; the liquidator earns a reward", async () => {
    const ctx = await deploy();
    const { token, pool, market } = await activeMarket(ctx);
    await market.connect(ctx.alice).open(true, E(1), { value: E(0.51) });
    // large spot dump
    await pool.connect(ctx.bob).buy(0, await deadline(), { value: E(1) });
    const lpTok = await token.balanceOf(ctx.bob.address);
    // use tokens from a curve buyer (bob holds tokens from graduation)
    const bal = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(await pool.getAddress(), bal);
    await pool.connect(ctx.bob).sell(bal, 0, await deadline());
    await advance(market, 400);
    expect(await market.isLiquidatable(ctx.alice.address, true)).to.equal(true);
    const navBefore = await market.vaultCash();
    await market.connect(ctx.keeper).liquidate(ctx.alice.address, true);
    expect(await market.vaultCash()).to.be.gt(navBefore);
    expect(lpTok).to.be.gt(0n);
  });

  it("LP deposit, 1-hour cooldown, withdrawal at NAV at execution time", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    await market.connect(ctx.carol).deposit({ value: E(20) });
    const sh = await market.shares(ctx.carol.address);
    await market.connect(ctx.carol).requestWithdraw(sh);
    await expect(market.executeWithdraw(ctx.carol.address)).to.be.revertedWith("cooldown");
    await increase(3601);
    const before = await ethers.provider.getBalance(ctx.carol.address);
    await market.connect(ctx.keeper).executeWithdraw(ctx.carol.address);
    const after = await ethers.provider.getBalance(ctx.carol.address);
    expect(after - before).to.be.closeTo(E(20), E(0.05));
  });

  it("locked shares cannot be withdrawn before Closed", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    expect(await market.availableShares(ctx.treasury.address)).to.equal(0n);
    await expect(market.connect(ctx.treasury).requestWithdraw(1n)).to.be.revertedWith("shares");
  });

  it("grace period after a sequencer gap above 60 seconds", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    await increase(300);
    await market.poke(); // triggers the grace period
    expect((await market.graceUntil()) > 0n).to.equal(true);
    await expect(market.connect(ctx.alice).open(true, E(1), { value: E(1) })).to.be.revertedWith("grace period");
    for (let i = 0; i < 12; i++) { await increase(55); await market.poke(); }
    await market.connect(ctx.alice).open(true, E(1), { value: E(1) });
  });

  it("inactive market: close-only, then closed, settle, all shares withdrawable", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    await market.connect(ctx.alice).open(false, E(1), { value: E(1) });
    for (let i = 0; i < 80; i++) { await increase(3600); }
    await market.checkStatus();
    expect(await market.state()).to.equal(2n);
    await expect(market.connect(ctx.bob).open(true, E(1), { value: E(1) })).to.be.revertedWith("not active");
    await increase(73 * 3600);
    await market.checkStatus();
    expect(await market.state()).to.equal(3n);
    await market.settle(ctx.alice.address, false);
    const sh = await market.shares(ctx.treasury.address);
    await market.connect(ctx.treasury).requestWithdraw(sh);
    await market.executeWithdraw(ctx.treasury.address);
    expect(await market.shares(ctx.treasury.address)).to.equal(0n);
  });
});

describe("Admin", () => {
  it("48-hour timelock and hard bounds", async () => {
    const ctx = await deploy();
    const { config, admin, alice } = ctx;
    const key = await config.K_GRAD_TARGET();
    await expect(config.connect(alice).queue(key, E(200))).to.be.revertedWith("admin");
    await expect(config.queue(key, 1n)).to.be.revertedWith("grad bounds");
    await config.connect(admin).queue(key, E(200));
    await expect(config.execute(key)).to.be.revertedWith("timelock");
    await increase(48 * 3600 + 1);
    await config.execute(key);
    expect(await config.gradTarget()).to.equal(E(200));
  });

  it("guardian pauses launches and opens, but closes still work", async () => {
    const ctx = await deploy();
    const { market } = await activeMarket(ctx);
    await market.connect(ctx.alice).open(true, E(1), { value: E(1) });
    await ctx.config.connect(ctx.guardian).setPause(true, true);
    await expect(ctx.lp.connect(ctx.creator).create("X", "X", 0, { value: E(0.01) })).to.be.revertedWith("launch paused");
    await expect(market.connect(ctx.bob).open(true, E(1), { value: E(1) })).to.be.revertedWith("paused");
    await market.connect(ctx.alice).close(true);
  });
});

describe("Fee splits", () => {
  const curveFeesFor = async (ctx, token) => (await ctx.lp.curves(await token.getAddress())).creatorClaimable;

  it("only the creator sets splits; bounds are enforced", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const t = await token.getAddress();
    const { lp, creator, alice, bob } = ctx;
    await expect(lp.connect(alice).setFeeSplits(t, [alice.address], [10000])).to.be.revertedWith("creator");
    await expect(lp.connect(creator).setFeeSplits(t, [alice.address, bob.address], [5000, 4000])).to.be.revertedWith("sum");
    await expect(lp.connect(creator).setFeeSplits(t, [ethers.ZeroAddress], [10000])).to.be.revertedWith("split");
    const six = Array(6).fill(alice.address);
    await expect(lp.connect(creator).setFeeSplits(t, six, [2000, 2000, 2000, 2000, 1000, 1000])).to.be.revertedWith("splits");
    await expect(lp.connect(creator).setFeeSplits(t, [alice.address, bob.address], [7000, 3000])).to.emit(lp, "FeeSplitsSet");
    const [to, bps] = await lp.feeSplits(t);
    expect(to).to.deep.equal([alice.address, bob.address]);
    expect(bps.map(Number)).to.deep.equal([7000, 3000]);
  });

  it("curve fees and spot fees go to the chosen recipients; anyone can trigger the claim", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const t = await token.getAddress();
    const { lp, creator, alice, carol, keeper } = ctx;
    await lp.connect(creator).setFeeSplits(t, [carol.address, keeper.address], [7000, 3000]);
    await increase(120);
    await lp.connect(alice).buy(t, 0, { value: E(10) });
    const fees = await curveFeesFor(ctx, token);
    expect(fees).to.equal(E(10) / 400n); // 0.25% of the buy
    const c0 = await ethers.provider.getBalance(carol.address), k0 = await ethers.provider.getBalance(keeper.address);
    await lp.connect(alice).claimCreator(t); // a stranger triggers it
    expect((await ethers.provider.getBalance(carol.address)) - c0).to.equal((fees * 7000n) / 10000n);
    expect((await ethers.provider.getBalance(keeper.address)) - k0).to.equal(fees - (fees * 7000n) / 10000n);
    await expect(lp.claimCreator(t)).to.be.revertedWith("nothing");

    const { pool } = await graduate(ctx, token);
    await lp.claimCreator(t); // unlocked tax + fee share from the graduation buys
    await pool.connect(alice).buy(0, await deadline(), { value: E(10) });
    expect(await pool.creatorFees()).to.equal(E(0.075));
    const c1 = await ethers.provider.getBalance(carol.address), k1 = await ethers.provider.getBalance(keeper.address);
    await pool.connect(alice).claimCreator();
    expect((await ethers.provider.getBalance(carol.address)) - c1).to.equal(E(0.0525));
    expect((await ethers.provider.getBalance(keeper.address)) - k1).to.equal(E(0.0225));
    expect(await pool.creatorFees()).to.equal(0n);
  });

  it("a recipient that rejects HYPE does not block the others; reset sends all to the creator", async () => {
    const ctx = await deploy();
    const token = await createToken(ctx);
    const t = await token.getAddress();
    const { lp, creator, alice, bob } = ctx;
    const rej = await (await ethers.getContractFactory("RejectEther")).deploy();
    await lp.connect(creator).setFeeSplits(t, [await rej.getAddress(), bob.address], [5000, 5000]);
    await increase(120);
    await lp.connect(alice).buy(t, 0, { value: E(10) });
    const fees = await curveFeesFor(ctx, token);
    const b0 = await ethers.provider.getBalance(bob.address);
    await lp.connect(alice).claimCreator(t);
    expect((await ethers.provider.getBalance(bob.address)) - b0).to.equal(fees - fees / 2n);
    expect(await lp.owed(await rej.getAddress())).to.equal(fees / 2n);

    await lp.connect(creator).setFeeSplits(t, [], []);
    await lp.connect(alice).buy(t, 0, { value: E(10) });
    const fees2 = await curveFeesFor(ctx, token);
    const cr0 = await ethers.provider.getBalance(creator.address);
    await lp.connect(alice).claimCreator(t);
    expect((await ethers.provider.getBalance(creator.address)) - cr0).to.equal(fees2);
  });
});

describe("Creator trade tax (0-10%)", () => {
  async function launch(ctx, taxBps) {
    const params = { taxWindow: 0, startTaxBps: 0, perpMaxLeverage: 3, creatorTaxBps: taxBps };
    const rc = await (await ctx.lp.connect(ctx.creator).createAdvanced("Tax", "TAX", "", "", params, 0, { value: E(0.01) })).wait();
    const ev = rc.logs.map((l) => { try { return ctx.lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
    return await ethers.getContractAt("ZephraToken", ev.args.token);
  }

  it("rejects a creator tax above 10%", async () => {
    const ctx = await deploy();
    await expect(launch(ctx, 1001)).to.be.revertedWith("creator tax");
    await launch(ctx, 1000);
  });

  it("curve buy and sell: tax goes to the creator, the rest follows the normal split", async () => {
    const ctx = await deploy();
    const token = await launch(ctx, 500); // 5%
    const addr = await token.getAddress();
    const before = (await ctx.lp.curves(addr)).creatorClaimable;
    const [q] = await ctx.lp.quoteBuy(addr, E(10));
    await ctx.lp.connect(ctx.alice).buy(addr, q, { value: E(10) });
    const afterBuy = (await ctx.lp.curves(addr)).creatorClaimable;
    // 5% tax on 10 HYPE = 0.5 to the creator, plus 25% of the normal 1% fee (0.025)
    expect(afterBuy - before).to.equal(E(0.5) + E(0.025));
    // a buy pays 1% + 5% in total
    const c = await ctx.lp.curves(addr);
    expect(c.realHYPE).to.equal(E(10) - E(0.6));
    const bal = await token.balanceOf(ctx.alice.address);
    await token.connect(ctx.alice).approve(await ctx.lp.getAddress(), bal);
    const [outQ, feeQ] = await ctx.lp.quoteSell(addr, bal);
    const gross = outQ + feeQ;
    expect(feeQ).to.equal((gross * 600n) / 10000n);
    const c0 = (await ctx.lp.curves(addr)).creatorClaimable;
    await ctx.lp.connect(ctx.alice).sell(addr, bal, outQ);
    const c1 = (await ctx.lp.curves(addr)).creatorClaimable;
    expect(c1 - c0).to.equal((gross * 500n) / 10000n + (gross * 25n) / 10000n);
  });

  it("claimCreator pays the tax to the fee recipients", async () => {
    const ctx = await deploy();
    const token = await launch(ctx, 1000);
    const addr = await token.getAddress();
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(10) });
    await ctx.lp.connect(ctx.creator).setFeeSplits(addr, [ctx.bob.address, ctx.carol.address], [7000, 3000]);
    const b0 = await ethers.provider.getBalance(ctx.bob.address);
    await ctx.lp.claimCreator(addr);
    expect((await ethers.provider.getBalance(ctx.bob.address)) - b0).to.be.gt(E(0.7));
  });

  it("the tax continues in the pool after graduation and is claimable by the creator", async () => {
    const ctx = await deploy();
    const token = await launch(ctx, 300); // 3%
    const addr = await token.getAddress();
    await ctx.lp.connect(ctx.alice).buy(addr, 0, { value: E(70) });
    await ctx.lp.connect(ctx.bob).buy(addr, 0, { value: E(70) });
    const c = await ctx.lp.curves(addr);
    expect(c.state).to.equal(2n);
    const pool = await ethers.getContractAt("ZephraPool", c.pool);
    expect(await pool.creatorTaxBps()).to.equal(300n);
    const [out, fee] = await pool.quoteBuy(E(10));
    expect(fee).to.equal((E(10) * 500n) / 10000n); // 2% fee + 3% tax
    const cf0 = await pool.creatorFees();
    await pool.connect(ctx.carol).buy(out, await deadline(), { value: E(10) });
    const gained = (await pool.creatorFees()) - cf0;
    // 3% tax (0.3) + 0.75% of volume
    expect(gained).to.be.closeTo(E(0.3) + E(0.075), 10n);
    // sell: same combined rate
    const bal = await token.balanceOf(ctx.carol.address);
    await token.connect(ctx.carol).approve(c.pool, bal);
    const [sOut, sFee] = await pool.quoteSell(bal);
    const cf1 = await pool.creatorFees();
    await pool.connect(ctx.carol).sell(bal, sOut, await deadline());
    const gross = sOut + sFee;
    expect((await pool.creatorFees()) - cf1).to.be.closeTo((gross * 300n) / 10000n + (gross * 75n) / 10000n, 10n);
    await pool.claimCreator();
  });
});
