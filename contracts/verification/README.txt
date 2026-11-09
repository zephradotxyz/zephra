Zephra source verification package

Compiler: solc 0.8.26 (longVersion 0.8.26+commit.8a97fa7a)
Optimizer: enabled, runs 200
viaIR: true
EVM version: paris
License: MIT
Input format: Solidity (Standard-Json-Input) -> verification/standard-input.json

Contract identifiers (use these exact names):
  ZephraConfig  ->  contracts/ZephraConfig.sol:ZephraConfig
  PoolFactory  ->  contracts/ZephraPool.sol:PoolFactory
  MarketFactory  ->  contracts/PerpMarket.sol:MarketFactory
  ZephraLaunchpad  ->  contracts/ZephraLaunchpad.sol:ZephraLaunchpad
  ZephraToken  ->  contracts/ZephraToken.sol:ZephraToken
  ZephraPool  ->  contracts/ZephraPool.sol:ZephraPool
  PerpMarket  ->  contracts/PerpMarket.sol:PerpMarket

Tokens, pools and markets are created by the launchpad/factories with identical bytecode.
Verify ONE ZephraToken, ONE ZephraPool and ONE PerpMarket after the first graduation; explorers that
support "similar match" then verify the rest automatically.

(No deployments/hardhat.json yet: constructor arguments are added after deploy.)
