// Builds a source-verification package for block explorers (no network access, no gas).
//   npx hardhat run scripts/verify-package.js
// Output: verification/standard-input.json (works for EVERY contract), flattened/<Name>.sol,
// and verification/README.txt with compiler settings + constructor arguments.
const fs = require("fs");
const path = require("path");
const { artifacts, run, network } = require("hardhat");
const { AbiCoder } = require("ethers");

async function main() {
  await run("compile");
  const out = path.join(__dirname, "..", "verification");
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(out, "flattened"), { recursive: true });
  const names = ["ZephraConfig", "PoolFactory", "MarketFactory", "ZephraLaunchpad", "ZephraToken", "ZephraPool", "PerpMarket"];
  const inputs = {};
  for (const n of names) {
    const bi = await artifacts.getBuildInfo(`contracts/${n === "PoolFactory" || n === "ZephraPool" ? "ZephraPool" : n === "MarketFactory" || n === "PerpMarket" ? "PerpMarket" : n}.sol:${n}`);
    inputs[n] = bi;
  }
  const bi = Object.values(inputs)[0];
  fs.writeFileSync(path.join(out, "standard-input.json"), JSON.stringify(bi.input, null, 2));
  const dep = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const d = fs.existsSync(dep) ? JSON.parse(fs.readFileSync(dep)) : null;
  const enc = (t, v) => AbiCoder.defaultAbiCoder().encode(t, v).slice(2);
  let txt = `Zephra source verification package\n\nCompiler: solc ${bi.solcVersion} (longVersion ${bi.solcLongVersion})\nOptimizer: enabled, runs 200\nviaIR: true\nEVM version: paris\nLicense: MIT\nInput format: Solidity (Standard-Json-Input) -> verification/standard-input.json\n\nContract identifiers (use these exact names):\n`;
  for (const n of names) {
    const src = Object.keys(bi.output.contracts).find((s) => bi.output.contracts[s][n]);
    txt += `  ${n}  ->  ${src}:${n}\n`;
  }
  txt += `\nTokens, pools and markets are created by the launchpad/factories with identical bytecode.\nVerify ONE ZephraToken, ONE ZephraPool and ONE PerpMarket after the first graduation; explorers that\nsupport "similar match" then verify the rest automatically.\n`;
  if (d) {
    const p = d.params, c = d.contracts;
    txt += `\nConstructor arguments (ABI-encoded, no 0x) for ${network.name}:\n`;
    txt += `  ZephraConfig    ${enc(["address","address","address","uint256","uint256"], [p.admin, p.guardian, p.treasury, p.gradTarget, p.creationFee])}\n`;
    txt += `  PoolFactory     ${enc(["address"], [c.ZephraConfig])}\n`;
    txt += `  MarketFactory   ${enc(["address"], [c.ZephraConfig])}\n`;
    txt += `  ZephraLaunchpad ${enc(["address","address","address"], [c.ZephraConfig, c.PoolFactory, c.MarketFactory])}\n`;
    txt += `Addresses:\n` + Object.entries(c).map(([k, v]) => `  ${k} ${v}`).join("\n") + "\n";
  } else txt += `\n(No deployments/${network.name}.json yet: constructor arguments are added after deploy.)\n`;
  fs.writeFileSync(path.join(out, "README.txt"), txt);
  for (const n of names) {
    const f = await run("flatten:get-flattened-sources", { files: [path.join(__dirname, "..", "contracts", n === "PoolFactory" || n === "ZephraPool" ? "ZephraPool.sol" : n === "MarketFactory" || n === "PerpMarket" ? "PerpMarket.sol" : `${n}.sol`)] }).catch(() => null);
    if (f) fs.writeFileSync(path.join(out, "flattened", `${n}.sol`), f);
  }
  console.log(txt);
}
main().catch((e) => { console.error(e); process.exit(1); });
