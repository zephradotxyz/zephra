// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPerpMarket} from "../Interfaces.sol";

interface IV4LaunchpadViews {
    function spotPrice(address token) external view returns (uint256);
    function twapOf(address token, uint256 window) external view returns (uint256);
    function reserveOf(address token) external view returns (uint256);
    function initialReserveOf(address token) external view returns (uint256);
    function volume72hOf(address token) external view returns (uint256);
    function poke(address token) external;
}

/// @title ZephraPoolView
/// @notice Presents one Uniswap v4 pool to its perp market through the interface the market expects
///         (price, TWAP, reserve, volume) and forwards the market's share of trading fees.
contract ZephraPoolView {
    address public immutable hook;
    address public immutable token;
    address public market;

    constructor(address hook_, address token_) {
        hook = hook_;
        token = token_;
    }

    function setMarket(address m) external {
        require(msg.sender == hook && market == address(0), "auth");
        market = m;
    }

    function pushFee(uint256 devPart) external payable {
        require(msg.sender == hook && market != address(0), "auth");
        IPerpMarket(market).receiveSpotFee{value: msg.value}(devPart);
    }

    function spotPrice() external view returns (uint256) {
        return IV4LaunchpadViews(hook).spotPrice(token);
    }

    function twap(uint256 window) external view returns (uint256) {
        return IV4LaunchpadViews(hook).twapOf(token, window);
    }

    function reserveHYPE() external view returns (uint256) {
        return IV4LaunchpadViews(hook).reserveOf(token);
    }

    function initialReserveHYPE() external view returns (uint256) {
        return IV4LaunchpadViews(hook).initialReserveOf(token);
    }

    function volume72h() external view returns (uint256) {
        return IV4LaunchpadViews(hook).volume72hOf(token);
    }

    function poke() external {
        IV4LaunchpadViews(hook).poke(token);
    }
}

contract ZephraPoolViewFactory {
    function create(address hook, address token) external returns (address) {
        require(msg.sender == hook, "hook");
        return address(new ZephraPoolView(hook, token));
    }
}
