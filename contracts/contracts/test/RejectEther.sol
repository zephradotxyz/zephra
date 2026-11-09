// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Test helper: a contract that refuses plain HYPE transfers.
contract RejectEther {
    receive() external payable {
        revert("no");
    }
}
