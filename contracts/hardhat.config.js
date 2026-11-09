require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const path = require("path");
const { subtask } = require("hardhat/config");
// Minimal .env loader (no dependency). Real environment variables win.
(() => {
  const fs = require("fs");
  const f = path.join(__dirname, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the local solc-js (npm "solc") so compiling does not need a binary download.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.26") {
    const compilerPath = path.join(__dirname, "node_modules", "solc", "soljson.js");
    return { compilerPath, isSolcJs: true, version: args.solcVersion, longVersion: "0.8.26+commit.8a97fa7a" };
  }
  return runSuper();
});

const PK = process.env.DEPLOYER_PK;

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
    overrides: {
      "contracts/v4/ZephraV4Launchpad.sol": {
        version: "0.8.26",
        settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: "cancun", debug: { revertStrings: "strip" } },
      },
    },
  },
  networks: {
    // `npm run fork` sets ZEPHRA_FORK=1: a local copy of Elysium testnet (chain 99801) with unlimited HYPE.
    hardhat:
      process.env.ZEPHRA_FORK === "1"
        ? {
            chainId: Number(process.env.FORK_CHAIN_ID || 99801),
            // mine a block every second like a real chain, so block time tracks wall time and the
            // keeper's heartbeat logic behaves exactly as on Elysium (idle automine would freeze time)
            mining: { auto: true, interval: 1000 },
            ...(process.env.FORK_URL && process.env.FORK_URL !== "none" ? { forking: { url: process.env.FORK_URL } } : {}),
          }
        : { allowUnlimitedContractSize: true },
    // local node started by `npm run fork` (override the port with LOCAL_RPC)
    localhost: { url: process.env.LOCAL_RPC || "http://127.0.0.1:8545", accounts: "remote" },
    elysiumTestnet: {
      url: process.env.ELYSIUM_RPC || "https://testnet-rpc.elysium.kinetiq.xyz",
      chainId: 99801,
      accounts: PK ? [PK] : [],
    },
    // Elysium mainnet. Use ONLY the RPC published on Kinetiq's official channels
    // (elysium.kinetiq.xyz / @Enter_Elysium). Chain ID 99901 unless Kinetiq announces otherwise.
    elysiumMainnet: {
      url: process.env.ELYSIUM_MAINNET_RPC || "http://set-ELYSIUM_MAINNET_RPC-in-contracts-.env.invalid",
      chainId: Number(process.env.ELYSIUM_MAINNET_CHAIN_ID || 99901),
      timeout: 180000,
      accounts: PK ? [PK] : [],
    },
  },
  mocha: { timeout: 120000 },
};
