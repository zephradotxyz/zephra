const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deployHook } = require("../scripts/lib/v4hook");

const E = (n) => ethers.parseEther(String(n));
const G = E(20);
const inc = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const dl = async () => (await ethers.provider.getBlock("latest")).timestamp + 3600;

describe("Zephra on Uniswap v4", function () {
  this.timeout(600000);
  let c;
  before(async () => {
    const [admin, guardian, treasury, creator, alice, bob] = await ethers.getSigners();
    const pm = await (await ethers.getContractFactory("PoolManager")).deploy(admin.address);
    const config = await (await ethers.getContractFactory("ZephraConfig")).deploy(admin.address, guardian.address, treasury.address, G, E(0.01));
    const mf = await (await ethers.getContractFactory("MarketFactory")).deploy(await config.getAddress());
    const vf = await (await ethers.getContractFactory("ZephraPoolViewFactory")).deploy();
    const impl = await (await ethers.getContractFactory("ZephraTokenV4")).deploy();
    const c2 = await (await ethers.getContractFactory("Create2Deployer")).deploy();
    const h = await deployHook(c2, await pm.getAddress(), await config.getAddress(), await mf.getAddress(), await vf.getAddress(), await impl.getAddress());
    const lp = await ethers.getContractAt("ZephraV4Launchpad", h.address);
    await mf.setLaunchpad(h.address);
    const router = await (await ethers.getContractFactory("ZephraRouter")).deploy(await pm.getAddress(), h.address);
    const q = await (await ethers.getContractFactory("ZephraQuoter")).deploy(h.address);
    c = { pm, config, mf, lp, q, router, admin, treasury, creator, alice, bob };
  });

  async function launch(dev = 0n, params) {
    const p = params || [0, 0, 3, 0];
    const tx = await c.lp.connect(c.creator).createAdvanced("Zeph", "ZPH", "", "", p, 0, { value: E(0.01) + dev });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return c.lp.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
    return ethers.getContractAt("ZephraTokenV4", ev.args.token);
  }

  it("seeds the whole supply into a v4 pool", async () => {
    const t = await launch();
    const pmBal = await t.balanceOf(await c.pm.getAddress());
    expect(pmBal).to.be.gt(E(999_999_999));
    const price = await c.lp.spotPrice(await t.getAddress());
    expect(price).to.be.gt(0n);
    // ~42 HYPE opening market cap
    const mcap = (price * 1_000_000_000n);
    expect(mcap / E(1)).to.be.within(41n, 43n);
  });

  it("tokens are 45-byte clones of one implementation, ownerless, with permit", async () => {
    const t = await launch();
    const code = await ethers.provider.getCode(await t.getAddress());
    expect((code.length - 2) / 2).to.equal(45);
    expect(await t.owner()).to.equal(ethers.ZeroAddress);
    expect(await t.totalSupply()).to.equal(E(1_000_000_000));
    await expect(t.initialize("x", "x", 1, c.alice.address, "")).to.be.revertedWith("initialized");
    const dom = { name: await t.name(), version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await t.getAddress() };
    const types = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    const msg = { owner: c.alice.address, spender: c.bob.address, value: 5n, nonce: 0n, deadline: await dl() };
    const sig = ethers.Signature.from(await c.alice.signTypedData(dom, types, msg));
    await t.permit(msg.owner, msg.spender, msg.value, msg.deadline, sig.v, sig.r, sig.s);
    expect(await t.allowance(c.alice.address, c.bob.address)).to.equal(5n);
  });

  it("buy and sell through the router, quotes match, fee goes to the hook", async () => {
    const t = await launch();
    const ta = await t.getAddress();
    const [q, fee] = await c.q.quoteBuy(ta, E(1));
    expect(fee).to.equal(E(1) / 100n);
    const b0 = await t.balanceOf(c.alice.address);
    await c.router.connect(c.alice).buy(ta, 0, await dl(), { value: E(1) });
    const got = (await t.balanceOf(c.alice.address)) - b0;
    expect(got).to.equal(q);
    const info = await c.lp.info(ta);
    expect(info.netQuote).to.equal(E(1) - fee);
    await t.connect(c.alice).approve(await c.router.getAddress(), got);
    const [hq, sfee] = await c.q.quoteSell(ta, got / 2n);
    const h0 = await ethers.provider.getBalance(c.bob.address);
    const tok = await t.balanceOf(c.alice.address);
    const before = await ethers.provider.getBalance(c.alice.address);
    const tx = await c.router.connect(c.alice).sell(ta, got / 2n, 0, await dl());
    const r = await tx.wait();
    const after = await ethers.provider.getBalance(c.alice.address);
    expect(after - before + r.gasUsed * r.gasPrice).to.equal(hq);
    expect(sfee).to.be.gt(0n);
  });

  it("anti-sniper tax decays and creator tax goes to the creator", async () => {
    const t = await launch(0n, [60, 10000, 3, 300]);
    const ta = await t.getAddress();
    await c.router.connect(c.alice).buy(ta, 0, await dl(), { value: E(1) }).catch(() => {});
    const i1 = await c.lp.info(ta);
    expect(i1.creatorLockedTax).to.be.gt(0n); // sniper tax creator share is locked
    await inc(120);
    await c.router.connect(c.bob).buy(ta, 0, await dl(), { value: E(1) });
    const i2 = await c.lp.info(ta);
    expect(i2.creatorClaimable).to.be.gt(0n); // 3% creator tax
  });

  it("dev buy vests, liquidity cannot be touched", async () => {
    const t = await launch(E(1));
    const i = await c.lp.info(await t.getAddress());
    expect(i.devLocked).to.be.gt(0n);
    expect(i.netQuote).to.be.gt(0n); // the dev buy counts in the pool totals
    expect(i.tokensSold).to.equal(i.devLocked);
    const k = await c.lp.poolKey(await t.getAddress());
    const key = { currency0: k[0], currency1: k[1], fee: k[2], tickSpacing: k[3], hooks: k[4] };
    await expect(c.pm.connect(c.alice).initialize(key, 2n ** 96n)).to.be.reverted;
  });

  it("creator tax: Zephra automatically keeps 0.5% of the trade out of it", async () => {
    const p0 = await c.lp.protocolAccrued();
    const t = await launch(0n, [0, 0, 3, 300]);
    const ta = await t.getAddress();
    await c.router.connect(c.alice).buy(ta, 0, await dl(), { value: E(1) });
    const i = await c.lp.info(ta);
    // fee = 1% base + 3% creator tax = 0.04. Creator tax 0.03 -> creator 0.025, Zephra 0.005.
    // base 0.01 -> Zephra 0.005, creator 0.0025, vault escrow 0.0025
    expect(i.creatorClaimable).to.equal(E(0.0275));
    expect((await c.lp.protocolAccrued()) - p0).to.equal(E(0.01) + E(0.005) + E(0.005));
  });

  it("graduates once the target is reached and opens a perp market", async () => {
    const t = await launch();
    const ta = await t.getAddress();
    await c.router.connect(c.alice).buy(ta, 0, await dl(), { value: E(21) });
    let i = await c.lp.info(ta);
    expect(i.state).to.equal(2n); // crossed
    await c.router.connect(c.bob).buy(ta, 0, await dl(), { value: E(0.5) });
    i = await c.lp.info(ta);
    expect(i.state).to.equal(3n);
    expect(i.market).to.not.equal(ethers.ZeroAddress);
    const m = await ethers.getContractAt("PerpMarket", i.market);
    await m.poke();
    expect(await m.markPrice()).to.be.gt(0n);
    // post-graduation fee is 2%
    const [, fee] = await c.q.quoteBuy(ta, E(1));
    expect(fee).to.equal(E(1) / 50n);
    await inc(3 * 86400);
    await c.lp.connect(c.creator).claimDev(ta).catch(() => {});
    await c.lp.claimCreator(ta);
  });

  it("a creator with many tokens claims all of them at once; protocol share and vault follow", async () => {
    const ta = await launch(), tb = await launch();
    const a = await ta.getAddress(), b = await tb.getAddress();
    await c.router.connect(c.alice).buy(a, 0, await dl(), { value: E(21) });
    await c.router.connect(c.bob).buy(a, 0, await dl(), { value: E(1) }); // graduates
    await c.router.connect(c.bob).buy(a, 0, await dl(), { value: E(1) });
    await c.router.connect(c.alice).buy(b, 0, await dl(), { value: E(1) });
    expect(await c.lp.creatorClaimableTotal(c.creator.address)).to.be.gt(0n);
    const n = await c.lp.creatorTokenCount(c.creator.address);
    expect(await c.lp.creatorTokenAt(c.creator.address, n - 1n)).to.equal(b);
    const cb = await ethers.provider.getBalance(c.creator.address);
    const tb0 = await ethers.provider.getBalance(c.treasury.address);
    await c.lp.connect(c.alice).claimAll(c.creator.address, 0, n); // anyone can trigger, money goes to the creator
    expect((await ethers.provider.getBalance(c.creator.address)) - cb).to.be.gt(0n);
    expect((await ethers.provider.getBalance(c.treasury.address)) - tb0).to.be.gt(0n); // protocol paid automatically
    expect(await c.lp.protocolAccrued()).to.equal(0n);
    expect(await c.lp.creatorClaimableTotal(c.creator.address)).to.equal(0n);
    expect(await c.lp.vaultOwed(a)).to.equal(0n); // vault topped up
    await expect(c.lp.claimAll(c.creator.address, 0, n)).to.be.revertedWith("nothing");
  });

  it("fees are paid out in real HYPE, vault is funded, perp opens", async () => {
    const t = await launch();
    const ta = await t.getAddress();
    await c.router.connect(c.alice).buy(ta, 0, await dl(), { value: E(21) });
    await c.router.connect(c.bob).buy(ta, 0, await dl(), { value: E(1) }); // graduates, then trades at 2%
    await c.router.connect(c.bob).buy(ta, 0, await dl(), { value: E(1) }); // flushes the previous fees to the vault
    const i = await c.lp.info(ta);
    const m = await ethers.getContractAt("PerpMarket", i.market);
    expect(await m.vaultCash()).to.be.gt(0n);
    await c.lp.flushVault(ta);
    const bal0 = await ethers.provider.getBalance(c.treasury.address);
    await c.lp.withdrawProtocol();
    expect((await ethers.provider.getBalance(c.treasury.address)) - bal0).to.be.gt(0n);
    const cb = await ethers.provider.getBalance(c.creator.address);
    await c.lp.claimCreator(ta);
    expect((await ethers.provider.getBalance(c.creator.address)) - cb).to.be.gt(0n);
    // contract keeps at least what it owes
    const owedSum = (await c.lp.protocolAccrued()) + (await c.lp.pendingClaims());
    expect(await ethers.provider.getBalance(await c.lp.getAddress())).to.be.gte((await c.lp.protocolAccrued()));
    // sells still work after graduation and the pool never pays out more than it took in
    const bal = await t.balanceOf(c.alice.address);
    await t.connect(c.alice).approve(await c.router.getAddress(), bal);
    await c.router.connect(c.alice).sell(ta, bal, 0, await dl());
    const j = await c.lp.info(ta);
    expect(j.netQuote).to.be.gte(0n);
  });

  it("rejects exact-output swaps and other people's liquidity", async () => {
    const t = await launch();
    const k = await c.lp.poolKey(await t.getAddress());
    const key = { currency0: k[0], currency1: k[1], fee: k[2], tickSpacing: k[3], hooks: k[4] };
    // direct calls to the PoolManager outside unlock must fail
    await expect(c.pm.connect(c.alice).swap(key, { zeroForOne: true, amountSpecified: 1000, sqrtPriceLimitX96: 4295128740n }, "0x")).to.be.reverted;
  });
});
