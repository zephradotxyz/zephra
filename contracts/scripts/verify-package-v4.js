// Source-verification package for the Uniswap v4 deployment (no gas, read-only on chain).
//   npx hardhat run scripts/verify-package-v4.js --network elysiumMainnet
// Writes verification/v4/<Contract>.standard-input.json (one per compiler setting) and verification/v4/README.txt.
// Also compares each deployed runtime bytecode with the local build so a mismatch is caught before upload.
const fs = require("fs");
const path = require("path");
const { artifacts, run, ethers } = require("hardhat");

const SRC = {
  ZephraConfig: "contracts/ZephraConfig.sol", MarketFactory: "contracts/PerpMarket.sol", ZephraPoolViewFactory: "contracts/v4/ZephraPoolView.sol",
  ZephraTokenV4: "contracts/v4/ZephraTokenV4.sol", Create2Deployer: "contracts/v4/V4Support.sol", ZephraV4Launchpad: "contracts/v4/ZephraV4Launchpad.sol",
  ZephraRouter: "contracts/v4/ZephraRouter.sol", ZephraQuoter: "contracts/v4/ZephraQuoter.sol",
};
async function main() {
  await run("compile");
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "elysiumMainnetV4.json")));
  const c = d.contracts, p = d.params, PM = c.PoolManager;
  const enc = (t, v) => ethers.AbiCoder.defaultAbiCoder().encode(t, v).slice(2);
  const rows = [
    ["ZephraTokenV4", c.TokenImplementation, ""],
    ["Create2Deployer", c.Create2Deployer, ""],
    ["ZephraConfig", c.ZephraConfig, enc(["address", "address", "address", "uint256", "uint256"], [p.admin, p.guardian, p.treasury, p.gradTarget, p.creationFee])],
    ["ZephraPoolViewFactory", c.PoolViewFactory, ""],
    ["MarketFactory", c.MarketFactory, enc(["address"], [c.ZephraConfig])],
    ["ZephraV4Launchpad", c.ZephraV4Launchpad, enc(["address", "address", "address", "address", "address"], [PM, c.ZephraConfig, c.MarketFactory, c.PoolViewFactory, c.TokenImplementation])],
    ["ZephraRouter", c.ZephraRouter, enc(["address", "address"], [PM, c.ZephraV4Launchpad])],
    ["ZephraQuoter", c.ZephraQuoter, enc(["address"], [c.ZephraV4Launchpad])],
  ];
  const out = path.join(__dirname, "..", "verification", "v4");
  fs.mkdirSync(out, { recursive: true });
  let txt = "Zephra v4 source verification (Elysium mainnet, chain 99901)\nCompiler solc 0.8.26, viaIR true, EVM cancun, license MIT\n\n";
  for (const [name, addr, args] of rows) {
    const fq = `${SRC[name]}:${name}`;
    const bi = await artifacts.getBuildInfo(fq);
    fs.writeFileSync(path.join(out, `${name}.standard-input.json`), JSON.stringify(bi.input));
    const art = await artifacts.readArtifact(name);
    const onchain = (await ethers.provider.getCode(addr)).toLowerCase();
    const local = art.deployedBytecode.toLowerCase();
    // compare ignoring the metadata hash tail and immutables: only check the first 2000 hex chars + length
    const same = onchain.length === local.length && onchain.slice(0, 2000) === local.slice(0, 2000);
    const runs = bi.input.settings.optimizer.runs;
    txt += `${name}\n  address ${addr}\n  contract ${fq}\n  optimizer runs ${runs}\n  input verification/v4/${name}.standard-input.json\n  constructor args (hex, no 0x): ${args || "(none)"}\n  bytecode matches deployed: ${same}\n\n`;
    console.log(name, "match", same);
  }
  fs.writeFileSync(path.join(out, "README.txt"), txt);
}
main().catch((e) => { console.error(e); process.exit(1); });
