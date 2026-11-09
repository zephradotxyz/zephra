// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./Interfaces.sol";

/// @title ZephraPool
/// @notice Constant-product TOKEN/HYPE AMM (native HYPE). LP is burned: permanent liquidity.
///         2% fee on the HYPE side: creator 0.75%, dev share 0.5%, vault LP 0.25%, Zephra 0.5%.
///         Keeps a per-second TWAP accumulator and hourly volume (72 hours).
contract ZephraPool {
    uint256 internal constant BPS = 10_000;
    uint256 public constant FEE_BPS = 200;
    uint256 public constant OBS_SIZE = 400;
    uint256 public constant OBS_SPACING = 10; // seconds between observations

    address public immutable token;
    address public immutable creator;
    address public immutable factory;
    /// @notice Launchpad that routes creator fees to the creator's fee splits.
    address public immutable launchpad;
    IZephraConfig public immutable config;
    address public market;
    /// @notice Creator tax on every buy and sell (bps, 0-1,000), set at launch and paid to the creator.
    uint16 public immutable creatorTaxBps;

    uint256 public reserveHYPE;
    uint256 public reserveToken;
    uint256 public initialReserveHYPE;

    uint256 public creatorFees;
    uint256 public protocolFees;

    // TWAP
    uint256 public priceCumulative;
    uint64 public lastCumTime;
    struct Obs {
        uint64 t;
        uint256 cum;
    }
    Obs[OBS_SIZE] internal obs;
    uint256 public obsIndex; // index of the latest observation
    uint256 public obsCount;

    // Hourly volume (HYPE)
    uint256[72] internal volBucket;
    uint64[72] internal volHour;

    uint256 private _lock = 1;

    event Swap(address indexed trader, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee, uint256 price);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address token_, address creator_, address config_, uint256 tokenAmount, uint16 creatorTaxBps_) payable {
        require(creatorTaxBps_ <= 1_000, "creator tax");
        creatorTaxBps = creatorTaxBps_;
        token = token_;
        creator = creator_;
        factory = msg.sender;
        launchpad = IPoolFactoryLaunchpad(msg.sender).launchpad();
        config = IZephraConfig(config_);
        reserveHYPE = msg.value;
        reserveToken = tokenAmount;
        initialReserveHYPE = msg.value;
        lastCumTime = uint64(block.timestamp);
        obs[0] = Obs(uint64(block.timestamp), 0);
        obsCount = 1;
    }

    function setMarket(address m) external {
        require(market == address(0), "set");
        require(msg.sender == factory || msg.sender == IPoolFactoryOwner(factory).launchpad(), "auth");
        market = m;
    }

    // ------------------------------------------------------------------
    // Prices
    // ------------------------------------------------------------------

    /// @notice HYPE per token, scaled by 1e18.
    function spotPrice() public view returns (uint256) {
        return (reserveHYPE * 1e18) / reserveToken;
    }

    function _cumNow() internal view returns (uint256) {
        return priceCumulative + spotPrice() * (block.timestamp - lastCumTime);
    }

    /// @notice TWAP over a window (seconds). If history is shorter, uses the oldest observation.
    function twap(uint256 window) public view returns (uint256) {
        if (window == 0) return spotPrice();
        uint256 target = block.timestamp > window ? block.timestamp - window : 0;
        Obs memory o = _obsAtOrBefore(target);
        if (o.t >= block.timestamp) return spotPrice();
        return (_cumNow() - o.cum) / (block.timestamp - o.t);
    }

    function _obsLogical(uint256 i) internal view returns (Obs memory) {
        uint256 start = obsCount < OBS_SIZE ? 0 : (obsIndex + 1) % OBS_SIZE;
        return obs[(start + i) % OBS_SIZE];
    }

    function _obsAtOrBefore(uint256 target) internal view returns (Obs memory) {
        Obs memory oldest = _obsLogical(0);
        if (target <= oldest.t) return oldest;
        uint256 lo = 0;
        uint256 hi = obsCount - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_obsLogical(mid).t <= target) lo = mid;
            else hi = mid - 1;
        }
        return _obsLogical(lo);
    }

    function _updateOracle() internal {
        uint64 nowT = uint64(block.timestamp);
        if (nowT > lastCumTime) {
            priceCumulative += spotPrice() * (nowT - lastCumTime);
            lastCumTime = nowT;
            if (nowT - obs[obsIndex].t >= OBS_SPACING) {
                obsIndex = (obsIndex + 1) % OBS_SIZE;
                obs[obsIndex] = Obs(nowT, priceCumulative);
                if (obsCount < OBS_SIZE) obsCount++;
            }
        }
    }

    function poke() external {
        _updateOracle();
    }

    // ------------------------------------------------------------------
    // Volume
    // ------------------------------------------------------------------

    function _recordVolume(uint256 hype) internal {
        uint64 h = uint64(block.timestamp / 1 hours);
        uint256 i = h % 72;
        if (volHour[i] != h) {
            volHour[i] = h;
            volBucket[i] = 0;
        }
        volBucket[i] += hype;
    }

    function volume72h() external view returns (uint256 v) {
        uint64 h = uint64(block.timestamp / 1 hours);
        for (uint256 i = 0; i < 72; i++) {
            if (volHour[i] + 72 > h) v += volBucket[i];
        }
    }

    // ------------------------------------------------------------------
    // Swap
    // ------------------------------------------------------------------

    function quoteBuy(uint256 hypeIn) public view returns (uint256 out, uint256 fee) {
        fee = (hypeIn * (FEE_BPS + creatorTaxBps)) / BPS; // protocol fee + creator tax
        uint256 net = hypeIn - fee;
        out = (reserveToken * net) / (reserveHYPE + net);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 out, uint256 fee) {
        uint256 gross = (reserveHYPE * tokensIn) / (reserveToken + tokensIn);
        fee = (gross * (FEE_BPS + creatorTaxBps)) / BPS;
        out = gross - fee;
    }

    function buy(uint256 minOut, uint256 deadline) external payable nonReentrant returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        require(msg.value > 0, "zero");
        _updateOracle();
        uint256 fee;
        (out, fee) = quoteBuy(msg.value);
        require(out >= minOut && out > 0, "slippage");
        reserveHYPE += msg.value - fee;
        reserveToken -= out;
        _recordVolume(msg.value);
        _distribute(fee);
        require(IERC20Min(token).transfer(msg.sender, out), "transfer");
        emit Swap(msg.sender, true, msg.value, out, fee, spotPrice());
    }

    function sell(uint256 tokensIn, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        require(tokensIn > 0, "zero");
        _updateOracle();
        uint256 gross = (reserveHYPE * tokensIn) / (reserveToken + tokensIn);
        uint256 fee = (gross * (FEE_BPS + creatorTaxBps)) / BPS;
        out = gross - fee;
        require(out >= minOut, "slippage");
        require(IERC20Min(token).transferFrom(msg.sender, address(this), tokensIn), "transferFrom");
        reserveToken += tokensIn;
        reserveHYPE -= gross;
        _recordVolume(gross);
        _distribute(fee);
        (bool ok, ) = msg.sender.call{value: out}("");
        require(ok, "send");
        emit Swap(msg.sender, false, gross, tokensIn, fee, spotPrice());
    }

    /// @dev 2% fee = creator 0.75% + dev share 0.5% + LP 0.25% + Zephra 0.5%
    /// @dev `fee` is the full amount taken from the trade. The creator tax part goes entirely to the creator;
    ///      the rest is the 2% fee split below.
    function _distribute(uint256 total) internal {
        uint256 tax = (total * creatorTaxBps) / (FEE_BPS + creatorTaxBps);
        uint256 fee = total - tax;
        creatorFees += tax;
        uint256 c = (fee * 3) / 8;
        uint256 dev = fee / 4;
        uint256 lp = fee / 8;
        uint256 p = fee - c - dev - lp;
        creatorFees += c;
        protocolFees += p;
        if (market != address(0)) {
            IPerpMarket(market).receiveSpotFee{value: dev + lp}(dev);
        } else {
            protocolFees += dev + lp;
        }
    }

    /// @notice Pays the creator's 0.75% of volume through the launchpad, which splits it among the
    /// recipients the creator chose. Anyone can trigger it; funds only ever go to those recipients.
    function claimCreator() external nonReentrant {
        uint256 a = creatorFees;
        require(a > 0, "nothing");
        creatorFees = 0;
        IFeeRouter(launchpad).payCreator{value: a}(token);
    }

    function withdrawProtocol() external nonReentrant {
        uint256 a = protocolFees;
        protocolFees = 0;
        (bool ok, ) = config.treasury().call{value: a}("");
        require(ok, "send");
    }
}

interface IPoolFactoryOwner {
    function launchpad() external view returns (address);
}

/// @title PoolFactory
contract PoolFactory {
    address public launchpad;
    address public immutable deployer;
    address public immutable config;

    constructor(address config_) {
        deployer = msg.sender;
        config = config_;
    }

    function setLaunchpad(address lp) external {
        require(msg.sender == deployer && launchpad == address(0), "auth");
        launchpad = lp;
    }

    function create(address token, address creator, uint256 tokenAmount, uint16 creatorTaxBps) external payable returns (address) {
        require(msg.sender == launchpad, "launchpad");
        return address(new ZephraPool{value: msg.value}(token, creator, config, tokenAmount, creatorTaxBps));
    }
}
