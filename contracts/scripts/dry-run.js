// Read-only mainnet dry run: sends NO transactions.
//   npx hardhat run scripts/dry-run.js --network elysiumMainnet
// Checks chain id, balances, roles, economics, and estimates deployment gas.
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice;
  const expected = Number(process.env.ELYSIUM_MAINNET_CHAIN_ID || 99901);
  const problems = [];
  const ok = (m) => console.log(`✓ ${m}`);
  const bad = (m) => { problems.push(m); console.log(`✗ ${m}`); };

  Number(net.chainId) === expected ? ok(`RPC chain ${net.chainId}`) : bad(`RPC chain ${net.chainId}, expected ${expected}`);
  ok(`deployer ${deployer.address} · ${ethers.formatEther(bal)} HYPE · gas price ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  const roles = {};
  for (const k of ["ADMIN", "GUARDIAN", "TREASURY"]) {
    const v = process.env[k];
    if (!v || !ethers.isAddress(v)) { bad(`${k} missing or invalid`); continue; }
    roles[k] = ethers.getAddress(v);
    const code = await ethers.provider.getCode(roles[k]);
    ok(`${k} ${roles[k]} (${code === "0x" ? "wallet (EOA)" : "contract, e.g. multisig"})`);
    if (roles[k] === deployer.address) bad(`${k} is the deployer`);
  }
  if (roles.ADMIN && roles.ADMIN === roles.GUARDIAN) bad("ADMIN and GUARDIAN are the same address");
  const G = Number(process.env.GRAD_TARGET), fee = Number(process.env.CREATION_FEE);
  G >= 1 && G <= 1_000_000 ? ok(`GRAD_TARGET ${G} HYPE`) : bad("GRAD_TARGET out of range");
  fee >= 0 && fee <= 10 ? ok(`CREATION_FEE ${fee} HYPE`) : bad("CREATION_FEE out of range");

  // gas estimate for the 4 contract creations (the two set-launchpad calls are small and added as a margin)
  const dummy = deployer.address;
  const cfgArgs = [roles.ADMIN || dummy, roles.GUARDIAN || dummy, roles.TREASURY || dummy, ethers.parseEther(String(G || 1)), ethers.parseEther(String(fee || 0))];
  let total = 0n;
  for (const [name, args] of [["ZephraConfig", cfgArgs], ["PoolFactory", [dummy]], ["MarketFactory", [dummy]], ["ZephraLaunchpad", [dummy, dummy, dummy]]]) {
    const f = await ethers.getContractFactory(name);
    const tx = await f.getDeployTransaction(...args);
    const g = await ethers.provider.estimateGas({ ...tx, from: deployer.address });
    total += g;
    console.log(`  ${name}: ~${g} gas`);
  }
  total += 200_000n;
  const cost = total * gasPrice;
  ok(`estimated total ~${total} gas ≈ ${ethers.formatEther(cost)} HYPE`);
  cost * 3n < bal ? ok("deployer balance covers the deployment with a 3x margin") : bad("deployer balance is too low for a safe margin");
  console.log(problems.length ? `\nDRY RUN FAILED: ${problems.length} problem(s)` : "\nDRY RUN PASSED. No transactions were sent.");
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
