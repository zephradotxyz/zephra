// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ZephraTokenV4
/// @notice The token every Zephra launch uses: a plain ERC-20 with EIP-2612 permit.
///         Fixed supply, no mint, no owner, no admin, no transfer tax, no blacklist, no pause.
///         Each launch is a tiny EIP-1167 clone of ONE verified implementation, so block explorers
///         show every Zephra token as verified code.
contract ZephraTokenV4 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    bool private _ready;
    /// @notice ERC-7572 metadata link (name, description, image) so explorers and trackers can show the logo.
    string public contractURI;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @dev The implementation itself can never be initialized; only clones can, once.
    constructor() {
        _ready = true;
    }

    function initialize(string calldata name_, string calldata symbol_, uint256 supply, address to, string calldata uri_) external {
        require(!_ready, "initialized");
        _ready = true;
        name = name_;
        symbol = symbol_;
        contractURI = uri_;
        totalSupply = supply;
        balanceOf[to] = supply;
        emit Transfer(address(0), to, supply);
    }

    /// @notice Always the zero address: nobody owns this token. Token scanners read this.
    function owner() external pure returns (address) {
        return address(0);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
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

    function permit(address owner_, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, nonces[owner_]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner_, "bad signature");
        allowance[owner_][spender] = value;
        emit Approval(owner_, spender, value);
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
