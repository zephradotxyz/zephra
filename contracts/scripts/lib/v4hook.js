// Mines a CREATE2 salt so the launchpad (a Uniswap v4 hook) lands on an address whose low 14 bits
// equal its permission flags: beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity,
// beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta.
const { ethers } = require("hardhat");
const HOOK_FLAGS = 0x2acc;
const MASK = 0x3fff;

async function deployHook(create2, poolManager, config, marketFactory, viewFactory, tokenImpl) {
  const F = await ethers.getContractFactory("ZephraV4Launchpad");
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "address"], [poolManager, config, marketFactory, viewFactory, tokenImpl]);
  const init = ethers.concat([F.bytecode, args]);
  const initHash = ethers.keccak256(init);
  const deployer = await create2.getAddress();
  for (let i = 0n; ; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initHash);
    if ((BigInt(addr) & BigInt(MASK)) === BigInt(HOOK_FLAGS)) {
      const tx = await create2.deploy(salt, init);
      await tx.wait();
      return { address: addr, salt, tx };
    }
  }
}
module.exports = { deployHook, HOOK_FLAGS };
