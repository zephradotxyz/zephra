// Resumable, nonce-pinned mainnet deploy of Zephra on Uniswap v4. Re-running never deploys anything twice.
//   DEPLOY_START_NONCE=<deployer nonce when step 0 was first sent>  (default: current nonce)
// Steps: token implementation, Create2Deployer, new ZephraConfig, pool-view factory, MarketFactory,
//        the hook (launchpad), MarketFactory.setLaunchpad, router, quoter.
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");
const { HOOK_FLAGS } = require("./lib/v4hook");

const PM = "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1";
const GRAD_TARGET = ethers.parseEther(process.env.GRAD_TARGET || "97"); // ~ $30K market cap at HYPE ~ $73
const CREATION_FEE = ethers.parseEther(process.env.CREATION_FEE || "0.05");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 99901) throw new Error(`wrong chain ${chainId}`);
  if (process.env.CONFIRM_MAINNET !== "yes") throw new Error("set CONFIRM_MAINNET=yes");
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnet.json")));
  const { admin, guardian, treasury } = old.params;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const startNonce = process.env.DEPLOY_START_NONCE !== undefined ? Number(process.env.DEPLOY_START_NONCE) : await ethers.provider.getTransactionCount(deployer.address, "latest");
  let step = 0;
  const nonceNow = () => ethers.provider.getTransactionCount(deployer.address, "latest");
  async function robust(label, tx, expectCode) {
    const nonce = startNonce + step++;
    for (let a = 0; a < 40; a++) {
      try {
        if ((await nonceNow()) > nonce) break;
        if ((await ethers.provider.getTransactionCount(deployer.address, "pending")) <= nonce) await deployer.sendTransaction({ ...tx, nonce });
        await sleep(2000);
      } catch (e) { console.log(`  ${label}: RPC hiccup (${(e.shortMessage || e.message || "").slice(0, 80)}), retrying`); await sleep(3000); }
    }
    for (let i = 0; i < 60 && (await nonceNow()) <= nonce; i++) await sleep(2000);
    if ((await nonceNow()) <= nonce) throw new Error(`${label} was not included`);
    if (expectCode) {
      const addr = ethers.getCreateAddress({ from: deployer.address, nonce });
      let code = "0x";
      for (let i = 0; i < 30 && code === "0x"; i++) { try { code = await ethers.provider.getCode(addr); } catch {} if (code === "0x") await sleep(2000); }
      if (code === "0x") throw new Error(`${label}: no code at ${addr}`);
      console.log(`  ${label} ${addr}`);
      return addr;
    }
    console.log(`  ${label} done`);
  }
  const create = async (name, args = []) => robust(name, await (await ethers.getContractFactory(name)).getDeployTransaction(...args), true);

  console.log(`Deployer ${deployer.address} · start nonce ${startNonce}`);
  const impl = await create("ZephraTokenV4");
  const c2 = await create("Create2Deployer");
  const config = await create("ZephraConfig", [admin, guardian, treasury, GRAD_TARGET, CREATION_FEE]);
  const vf = await create("ZephraPoolViewFactory");
  const mf = await create("MarketFactory", [config]);

  // the hook must sit on an address whose low bits encode its permissions: mine a salt for it
  const F = await ethers.getContractFactory("ZephraV4Launchpad");
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "address"], [PM, config, mf, vf, impl]);
  const init = ethers.concat([F.bytecode, args]);
  const hash = ethers.keccak256(init);
  let salt, hook;
  for (let i = 0n; ; i++) {
    salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    hook = ethers.getCreate2Address(c2, salt, hash);
    if ((BigInt(hook) & 0x3fffn) === BigInt(HOOK_FLAGS)) break;
  }
  const c2c = new ethers.Contract(c2, ["function deploy(bytes32,bytes) returns (address)"], deployer);
  await robust("ZephraV4Launchpad (hook)", await c2c.deploy.populateTransaction(salt, init), false);
  if ((await ethers.provider.getCode(hook)).length <= 2) throw new Error("hook not deployed at " + hook);
  console.log(`  hook ${hook}`);
  const mfc = new ethers.Contract(mf, ["function setLaunchpad(address)"], deployer);
  await robust("MarketFactory.setLaunchpad", await mfc.setLaunchpad.populateTransaction(hook), false);
  const router = await create("ZephraRouter", [PM, hook]);
  const quoter = await create("ZephraQuoter", [hook]);

  const out = {
    network: network.name, chainId, version: "v4", deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
    contracts: { ZephraConfig: config, MarketFactory: mf, PoolViewFactory: vf, TokenImplementation: impl, Create2Deployer: c2, ZephraV4Launchpad: hook, ZephraRouter: router, ZephraQuoter: quoter, PoolManager: PM },
    params: { gradTarget: GRAD_TARGET.toString(), creationFee: CREATION_FEE.toString(), admin, guardian, treasury },
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnetV4.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.contracts, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
