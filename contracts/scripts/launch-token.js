// Launch one token on the live Zephra deployment with the deployer wallet.
//   LAUNCH_IMAGE=<file> LAUNCH_NAME=Elysium LAUNCH_SYMBOL=ELYSIUM DEV_BUY=0.2 node scripts via hardhat --network elysiumMainnet
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers, network } = require("hardhat");

async function main() {
  if (process.env.CONFIRM_MAINNET !== "yes") throw new Error("set CONFIRM_MAINNET=yes");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`)));
  const [me] = await ethers.getSigners();
  const lp = await ethers.getContractAt("ZephraLaunchpad", dep.contracts.ZephraLaunchpad);
  const cfg = await ethers.getContractAt("ZephraConfig", dep.contracts.ZephraConfig);
  const fee = await cfg.creationFee();
  const devBuy = ethers.parseEther(process.env.DEV_BUY || "0");
  const bal = await ethers.provider.getBalance(me.address);
  console.log(`deployer ${me.address} balance ${ethers.formatEther(bal)} HYPE · need ${ethers.formatEther(fee + devBuy)} + gas`);
  if (bal < fee + devBuy + ethers.parseEther("0.02")) throw new Error("balance too low");

  const out = "/home/runner/workspace/.local/launch-logo.jpg";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("convert", [process.env.LAUNCH_IMAGE, "-resize", "512x512", "-strip", "-quality", "85", out]);
  const image = "data:image/jpeg;base64," + fs.readFileSync(out).toString("base64");
  const name = process.env.LAUNCH_NAME, symbol = process.env.LAUNCH_SYMBOL;
  const r = await fetch(`${process.env.API_URL}/ipfs/launch`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, symbol, description: process.env.LAUNCH_DESC || `${name} on Zephra`, image }),
  });
  const j = await r.json();
  if (!r.ok || !j.metadataURI) throw new Error("metadata upload failed: " + JSON.stringify(j));
  console.log("metadata", j.metadataURI);

  const rc = await (await lp.createAdvanced(name, symbol, j.metadataURI, "", { taxWindow: 0, startTaxBps: 10000, perpMaxLeverage: 3, creatorTaxBps: 0 }, 0, { value: fee + devBuy })).wait();
  const ev = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "TokenCreated");
  console.log("TOKEN", ev.args.token, "tx", rc.hash);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
