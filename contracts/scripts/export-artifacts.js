// Regenerates the ABIs + bytecode the web app and keeper use (run after any contract change).
//   node scripts/export-artifacts.js
const fs = require("fs");
const path = require("path");
const art = (file, name) => require(path.join(__dirname, "..", "artifacts", "contracts", file, `${name}.json`));
const withCode = { ZephraConfig: "ZephraConfig.sol", PoolFactory: "ZephraPool.sol", MarketFactory: "PerpMarket.sol", ZephraLaunchpad: "ZephraLaunchpad.sol" };
const abiOnly = { ZephraPool: "ZephraPool.sol", PerpMarket: "PerpMarket.sol", ZephraToken: "ZephraToken.sol" };
const out = {};
for (const [n, f] of Object.entries(withCode)) { const a = art(f, n); out[n] = { abi: a.abi, bytecode: a.bytecode }; }
for (const [n, f] of Object.entries(abiOnly)) out[n] = { abi: art(f, n).abi };
const root = path.join(__dirname, "..", "..");
fs.writeFileSync(path.join(root, "app/src/chain/artifacts.json"), JSON.stringify(out));
const abis = Object.fromEntries(["ZephraConfig", "ZephraLaunchpad", "ZephraPool", "PerpMarket", "ZephraToken"].map((n) => [n, out[n].abi]));
for (const t of ["app/src/chain/abi.json", "keeper/abi.json"]) fs.writeFileSync(path.join(root, t), JSON.stringify(abis));
console.log("Wrote app/src/chain/artifacts.json, app/src/chain/abi.json, keeper/abi.json");
