// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function burn(uint256) external;
    function totalSupply() external view returns (uint256);
}

interface IZephraConfig {
    function admin() external view returns (address);
    function treasury() external view returns (address);
    function launchPaused() external view returns (bool);
    function perpOpenPaused() external view returns (bool);
    function gradTarget() external view returns (uint256);
    function creationFee() external view returns (uint256);
    function guardedLaunch() external view returns (bool);
}

interface IZephraPool {
    function spotPrice() external view returns (uint256);
    function twap(uint256 window) external view returns (uint256);
    function reserveHYPE() external view returns (uint256);
    function initialReserveHYPE() external view returns (uint256);
    function volume72h() external view returns (uint256);
    function poke() external;
    function setMarket(address) external;
}

interface IPerpMarket {
    function receiveSpotFee(uint256 devPart) external payable;
    function initVault(uint256 seed, uint256 escrow) external payable;
}

/// @notice Creator fee routing on the launchpad (fee splits).
interface IFeeRouter {
    function payCreator(address token) external payable;
}

interface IPoolFactoryLaunchpad {
    function launchpad() external view returns (address);
}

interface IPoolFactory {
    function create(address token, address creator, uint256 tokenAmount, uint16 creatorTaxBps) external payable returns (address);
}

interface IMarketFactory {
    function create(address token, address pool, address creator, uint256 gradTarget, uint8 maxLeverage) external returns (address);
}
