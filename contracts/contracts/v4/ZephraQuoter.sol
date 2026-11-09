// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IZephraHook {
    function poolManager() external view returns (IPoolManager);
    function poolId(address token) external view returns (bytes32);
    function buyFeeBps(address token) external view returns (uint256 bps, bool isTax);
    function sellFeeBps(address token) external view returns (uint256);
    function launchParams(address token) external view returns (uint32, uint16, uint8, uint16);
    function liquidity(address token) external pure returns (uint128);
}

/// @notice Read-only price quotes for Zephra's Uniswap v4 pools (kept out of the hook to stay under the code size limit).
contract ZephraQuoter {
    using StateLibrary for IPoolManager;

    IZephraHook public immutable hook;
    int24 internal constant START_TICK = 169_800;
    int24 internal constant LOWER_TICK = 120_200;

    constructor(address hook_) {
        hook = IZephraHook(hook_);
    }

    function quoteBuy(address token, uint256 hypeIn) external view returns (uint256 tokensOut, uint256 fee, uint256 used) {
        (uint256 bps,) = hook.buyFeeBps(token);
        (,,, uint16 ctax) = hook.launchParams(token);
        uint256 rate = bps + ctax;
        if (rate >= 10_000) rate = 9_999;
        fee = (hypeIn * rate) / 10_000;
        (uint160 sqrtP,,,) = hook.poolManager().getSlot0(PoolId.wrap(hook.poolId(token)));
        (, uint256 amtIn, uint256 amtOut,) = SwapMath.computeSwapStep(
            sqrtP, TickMath.getSqrtPriceAtTick(LOWER_TICK), hook.liquidity(token), -int256(hypeIn - fee), 0
        );
        tokensOut = amtOut;
        used = amtIn + fee;
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 hypeOut, uint256 fee) {
        (uint160 sqrtP,,,) = hook.poolManager().getSlot0(PoolId.wrap(hook.poolId(token)));
        (,, uint256 gross,) = SwapMath.computeSwapStep(
            sqrtP, TickMath.getSqrtPriceAtTick(START_TICK), hook.liquidity(token), -int256(tokensIn), 0
        );
        fee = (gross * hook.sellFeeBps(token)) / 10_000;
        hypeOut = gross - fee;
    }
}
