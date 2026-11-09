// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Compiles Uniswap's PoolManager so tests can deploy a real one locally, and provides a CREATE2 deployer
// used to place the hook at an address whose low bits encode its permissions.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

contract Create2Deployer {
    event Deployed(address addr);

    function deploy(bytes32 salt, bytes memory code) external returns (address a) {
        assembly {
            a := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(a != address(0), "create2");
        emit Deployed(a);
    }
}
