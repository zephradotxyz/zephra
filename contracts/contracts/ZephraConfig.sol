// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ZephraConfig
/// @notice Zephra admin and guardian.
///  - Guardian: instant pause (new launches, new perp positions). Cannot touch funds.
///  - Admin: changes parameters through a 48-hour timelock, always within hard bounds.
///  - There is no function to withdraw user, LP or vault funds.
contract ZephraConfig {
    uint256 public constant TIMELOCK = 48 hours;

    // Hard bounds (the admin cannot exceed them)
    uint256 public constant MAX_CREATION_FEE = 10 ether;
    uint256 public constant MIN_GRAD_TARGET = 1 ether;
    uint256 public constant MAX_GRAD_TARGET = 1_000_000 ether;

    bytes32 public constant K_GRAD_TARGET = keccak256("GRAD_TARGET");
    bytes32 public constant K_CREATION_FEE = keccak256("CREATION_FEE");
    bytes32 public constant K_GUARDED = keccak256("GUARDED_LAUNCH");
    bytes32 public constant K_TREASURY = keccak256("TREASURY");
    bytes32 public constant K_GUARDIAN = keccak256("GUARDIAN");
    bytes32 public constant K_ADMIN = keccak256("ADMIN");

    address public admin;
    address public guardian;
    address public treasury;

    bool public launchPaused;
    bool public perpOpenPaused;

    uint256 public gradTarget; // G, in HYPE wei
    uint256 public creationFee;
    bool public guardedLaunch = true; // vault NAV <= 5 x G per market

    struct Queued {
        uint256 value;
        uint64 eta;
        bool exists;
    }

    mapping(bytes32 => Queued) public queued;

    event Paused(bool launchPaused, bool perpOpenPaused);
    event Queue(bytes32 indexed key, uint256 value, uint64 eta);
    event Execute(bytes32 indexed key, uint256 value);
    event Cancel(bytes32 indexed key);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin");
        _;
    }

    constructor(address admin_, address guardian_, address treasury_, uint256 gradTarget_, uint256 creationFee_) {
        require(gradTarget_ >= MIN_GRAD_TARGET && gradTarget_ <= MAX_GRAD_TARGET, "grad bounds");
        require(creationFee_ <= MAX_CREATION_FEE, "fee bounds");
        admin = admin_;
        guardian = guardian_;
        treasury = treasury_;
        gradTarget = gradTarget_;
        creationFee = creationFee_;
    }

    /// @notice Instant pause. Pausing never blocks closing positions, adding margin,
    ///         LP withdrawals or selling on the curve.
    function setPause(bool launch, bool perpOpen) external {
        require(msg.sender == guardian || msg.sender == admin, "guardian");
        launchPaused = launch;
        perpOpenPaused = perpOpen;
        emit Paused(launch, perpOpen);
    }

    function queue(bytes32 key, uint256 value) external onlyAdmin {
        _check(key, value);
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        queued[key] = Queued(value, eta, true);
        emit Queue(key, value, eta);
    }

    function cancel(bytes32 key) external onlyAdmin {
        delete queued[key];
        emit Cancel(key);
    }

    function execute(bytes32 key) external {
        Queued memory q = queued[key];
        require(q.exists, "not queued");
        require(block.timestamp >= q.eta, "timelock");
        delete queued[key];
        if (key == K_GRAD_TARGET) gradTarget = q.value;
        else if (key == K_CREATION_FEE) creationFee = q.value;
        else if (key == K_GUARDED) guardedLaunch = q.value != 0;
        else if (key == K_TREASURY) treasury = address(uint160(q.value));
        else if (key == K_GUARDIAN) guardian = address(uint160(q.value));
        else if (key == K_ADMIN) admin = address(uint160(q.value));
        emit Execute(key, q.value);
    }

    function _check(bytes32 key, uint256 value) internal pure {
        if (key == K_GRAD_TARGET) require(value >= MIN_GRAD_TARGET && value <= MAX_GRAD_TARGET, "grad bounds");
        else if (key == K_CREATION_FEE) require(value <= MAX_CREATION_FEE, "fee bounds");
        else if (key == K_GUARDED) require(value <= 1, "bool");
        else if (key == K_TREASURY || key == K_GUARDIAN || key == K_ADMIN) {
            require(value != 0 && value <= type(uint160).max, "addr");
        } else revert("unknown key");
    }
}
