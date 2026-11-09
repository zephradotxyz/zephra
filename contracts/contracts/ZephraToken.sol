// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ZephraToken
/// @notice Plain ERC-20: fixed supply, no mint, no transfer tax, immutable metadata.
///         All fees and taxes are charged in the Launchpad and Pool contracts, not in the token,
///         so the token can be bridged to HyperEVM and HyperCore.
contract ZephraToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    /// @notice Always the zero address: nobody owns this token, so nobody can change it. Token scanners read this.
    function owner() external pure returns (address) {
        return address(0);
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply, address to) {
        name = name_;
        symbol = symbol_;
        totalSupply = supply;
        balanceOf[to] = supply;
        emit Transfer(address(0), to, supply);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance");
            allowance[from][msg.sender] = a - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Burn your own tokens (used by the Launchpad for the leftover reserve at graduation).
    function burn(uint256 value) external {
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero");
        require(balanceOf[from] >= value, "balance");
        unchecked {
            balanceOf[from] -= value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
