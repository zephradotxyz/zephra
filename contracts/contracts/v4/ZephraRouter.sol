// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20Min} from "../Interfaces.sol";

interface ILaunchpadKey {
    function poolKey(address token) external view returns (PoolKey memory);
}

/// @title ZephraRouter
/// @notice Simple exact-input router for Zephra pools on Uniswap v4 (buy with HYPE, sell tokens for HYPE),
///         with a minimum output and a deadline. Any other v4 router also works: the pool is a normal pool.
contract ZephraRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;
    ILaunchpadKey public immutable launchpad;

    constructor(address poolManager_, address launchpad_) {
        poolManager = IPoolManager(poolManager_);
        launchpad = ILaunchpadKey(launchpad_);
    }

    function buy(address token, uint256 minOut, uint256 deadline) external payable returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        require(msg.value > 0, "zero");
        out = abi.decode(poolManager.unlock(abi.encode(true, token, msg.value, msg.sender)), (uint256));
        require(out >= minOut, "slippage");
    }

    function sell(address token, uint256 tokensIn, uint256 minOut, uint256 deadline) external returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        require(tokensIn > 0, "zero");
        out = abi.decode(poolManager.unlock(abi.encode(false, token, tokensIn, msg.sender)), (uint256));
        require(out >= minOut, "slippage");
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pool manager");
        (bool isBuy, address token, uint256 amount, address user) = abi.decode(data, (bool, address, uint256, address));
        PoolKey memory key = launchpad.poolKey(token);
        if (isBuy) {
            BalanceDelta d = poolManager.swap(
                key,
                SwapParams({zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
                abi.encode(user)
            );
            poolManager.settle{value: uint256(uint128(-d.amount0()))}();
            uint256 out = uint256(uint128(d.amount1()));
            poolManager.take(key.currency1, user, out);
            return abi.encode(out);
        }
        BalanceDelta d2 = poolManager.swap(
            key,
            SwapParams({zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            abi.encode(user)
        );
        uint256 tokensIn = uint256(uint128(-d2.amount1()));
        poolManager.sync(key.currency1);
        require(IERC20Min(token).transferFrom(user, address(poolManager), tokensIn), "transfer");
        poolManager.settle();
        uint256 out2 = uint256(uint128(d2.amount0()));
        poolManager.take(key.currency0, user, out2);
        return abi.encode(out2);
    }
}
