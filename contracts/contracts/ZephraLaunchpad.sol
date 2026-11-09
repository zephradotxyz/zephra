// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./ZephraToken.sol";
import "./Interfaces.sol";

/// @title ZephraLaunchpad
/// @notice Token creation, bonding curve (constant product with virtual reserves),
///         anti-sniper tax, locked dev buy, graduation and failed graduation.
contract ZephraLaunchpad {
    uint256 internal constant BPS = 10_000;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 800_000_000 ether;
    uint256 public constant VIRTUAL_TOKENS = 1_073_000_000 ether; // T0
    uint256 public constant DEV_BUY_MAX = 100_000_000 ether; // 10% of supply
    uint256 public constant DEV_VEST = 3 days;
    uint256 public constant TAX_WINDOW = 60; // default anti-sniper window (seconds)
    uint256 public constant TAX_START_BPS = 10_000; // default start tax: 100%
    uint256 public constant TAX_END_BPS = 200; // tax always decays to 2%
    // Creator-configurable bounds
    uint256 public constant MIN_TAX_WINDOW = 30;
    uint256 public constant MAX_TAX_WINDOW = 300;
    uint256 public constant MIN_START_TAX_BPS = 1_000; // 10%
    uint256 public constant MAX_PERP_LEVERAGE = 3;
    uint256 public constant MAX_CREATOR_TAX_BPS = 1_000; // creator trade tax cap: 10%
    uint256 public constant FEE_BPS = 100; // 1% bonding fee
    uint256 public constant FAIL_AGE = 7 days;
    uint256 public constant FAIL_IDLE = 72 hours;

    enum State {
        None,
        Bonding,
        Graduated,
        Failed
    }

    struct Curve {
        address creator;
        State state;
        uint64 createdAt;
        uint64 lastTradeAt;
        uint64 gradAt;
        uint256 gradTarget; // G
        uint256 virtualHYPE; // V0
        uint256 realHYPE; // real HYPE in the curve
        uint256 tokensSold; // includes the dev buy
        uint256 creatorClaimable;
        uint256 creatorLockedTax; // unlocks at graduation or failure
        uint256 escrow; // moves to the vault at graduation
        uint256 devLocked;
        uint256 devClaimed;
        address pool;
        address market;
    }

    /// @notice Per-token launch settings chosen by the creator (within protocol bounds).
    struct LaunchParams {
        uint32 taxWindow; // 0 = anti-sniper tax disabled, else 30-300 seconds
        uint16 startTaxBps; // 1,000-10,000 (10%-100%), decays linearly to 2%
        uint8 perpMaxLeverage; // 1-3x cap for the perp market after graduation
        uint16 creatorTaxBps; // 0-1,000 (0%-10%): permanent tax on every buy and sell, paid to the creator
    }

    IZephraConfig public immutable config;
    IPoolFactory public immutable poolFactory;
    IMarketFactory public immutable marketFactory;

    mapping(address => Curve) public curves;
    mapping(address => LaunchParams) public launchParams;
    /// @notice JSON metadata set by the creator at launch (description, website, X, Telegram, image).
    mapping(address => string) public metadata;

    /// @notice Fee splits: where a creator's earnings go (curve fee share, unlocked tax, spot 1%).
    /// Empty = everything to the creator. Up to 5 recipients; shares in bps summing to 10,000.
    struct Split {
        address to;
        uint16 bps;
    }
    mapping(address => Split[]) internal _splits;
    uint256 public constant MAX_SPLITS = 5;
    /// @notice HYPE a split recipient could not receive (e.g. a contract that rejects transfers).
    mapping(address => uint256) public owed;
    address[] public allTokens;
    uint256 public protocolAccrued;

    uint256 private _lock = 1;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 devTokens,
        uint32 taxWindow,
        uint16 startTaxBps,
        uint8 perpMaxLeverage,
        string metadata
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 hypeAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 realHYPE,
        uint256 tokensSold
    );
    /// @notice Token logo (data URI or URL). Emitted only — not stored — to keep launches cheap.
    event TokenImage(address indexed token, string image);
    event Graduated(address indexed token, address pool, address market, uint256 poolHYPE, uint256 poolTokens);
    event Failed(address indexed token);
    event FeeSplitsSet(address indexed token, address[] to, uint16[] bps);
    event CreatorPaid(address indexed token, uint256 amount);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address config_, address poolFactory_, address marketFactory_) {
        config = IZephraConfig(config_);
        poolFactory = IPoolFactory(poolFactory_);
        marketFactory = IMarketFactory(marketFactory_);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function isInsider(address token, address who) external view returns (bool) {
        return curves[token].creator == who;
    }

    /// @notice Current buy rate (bps). First 60 seconds: linear tax from 100% to 2%.
    function buyFeeBps(address token) public view returns (uint256 bps, bool isTax) {
        Curve storage c = curves[token];
        LaunchParams storage lp = launchParams[token];
        uint256 t = block.timestamp - c.createdAt;
        if (lp.taxWindow > 0 && t < lp.taxWindow && lp.startTaxBps > FEE_BPS) {
            uint256 drop = ((uint256(lp.startTaxBps) - TAX_END_BPS) * t) / lp.taxWindow;
            uint256 v = uint256(lp.startTaxBps) - drop;
            return (v > TAX_END_BPS ? v : TAX_END_BPS, true);
        }
        return (FEE_BPS, false);
    }

    function curvePrice(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        uint256 vH = c.virtualHYPE + c.realHYPE;
        uint256 vT = VIRTUAL_TOKENS - c.tokensSold;
        return (vH * 1e18) / vT;
    }

    function quoteBuy(address token, uint256 hypeIn) external view returns (uint256 tokensOut, uint256 fee, uint256 used) {
        Curve storage c = curves[token];
        (uint256 bps, ) = buyFeeBps(token);
        (tokensOut, fee, used) = _buyMath(c, hypeIn, _withCreatorTax(token, bps));
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 hypeOut, uint256 fee) {
        Curve storage c = curves[token];
        uint256 gross = _sellGross(c, tokensIn);
        fee = (gross * (FEE_BPS + launchParams[token].creatorTaxBps)) / BPS;
        hypeOut = gross - fee;
    }

    /// @dev Adds the creator tax to a buy rate; never reaches 100% on its own.
    function _withCreatorTax(address token, uint256 bps) internal view returns (uint256) {
        if (bps >= BPS) return bps;
        uint256 total = bps + launchParams[token].creatorTaxBps;
        return total >= BPS ? BPS - 1 : total;
    }

    function failable(address token) public view returns (bool) {
        Curve storage c = curves[token];
        if (c.state != State.Bonding) return false;
        return block.timestamp >= c.createdAt + FAIL_AGE || block.timestamp >= c.lastTradeAt + FAIL_IDLE;
    }

    function devVested(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.state == State.Failed) return c.devLocked;
        if (c.state != State.Graduated) return 0;
        uint256 el = block.timestamp - c.gradAt;
        if (el >= DEV_VEST) return c.devLocked;
        return (c.devLocked * el) / DEV_VEST;
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    /// @notice Create a token with default settings (60s tax from 100%, 3x perp).
    function create(string calldata name, string calldata symbol, uint256 devMinOut) external payable returns (address) {
        return createAdvanced(name, symbol, "", "", LaunchParams(uint32(TAX_WINDOW), uint16(TAX_START_BPS), uint8(MAX_PERP_LEVERAGE), 0), devMinOut);
    }

    /// @notice Create a token. msg.value = creation fee + optional dev buy (max 10% of supply, no tax).
    /// @param meta JSON metadata (max 1,024 bytes)
    /// @param image logo as a data URI or URL (max 16,384 bytes), emitted in TokenImage
    /// @param p creator settings: anti-sniper window/start tax and perp leverage cap
    function createAdvanced(
        string calldata name,
        string calldata symbol,
        string memory meta,
        string memory image,
        LaunchParams memory p,
        uint256 devMinOut
    )
        public
        payable
        nonReentrant
        returns (address token)
    {
        require(p.taxWindow == 0 || (p.taxWindow >= MIN_TAX_WINDOW && p.taxWindow <= MAX_TAX_WINDOW), "tax window");
        require(p.taxWindow == 0 || (p.startTaxBps >= MIN_START_TAX_BPS && p.startTaxBps <= BPS), "start tax");
        require(p.perpMaxLeverage >= 1 && p.perpMaxLeverage <= MAX_PERP_LEVERAGE, "leverage");
        require(p.creatorTaxBps <= MAX_CREATOR_TAX_BPS, "creator tax");
        require(bytes(meta).length <= 1024, "metadata");
        require(bytes(image).length <= 16_384, "image");
        require(!config.launchPaused(), "launch paused");
        uint256 fee = config.creationFee();
        require(msg.value >= fee, "creation fee");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "name");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 10, "symbol");

        token = address(new ZephraToken(name, symbol, SUPPLY, address(this)));
        uint256 G = config.gradTarget();
        Curve storage c = curves[token];
        c.creator = msg.sender;
        c.state = State.Bonding;
        c.createdAt = uint64(block.timestamp);
        c.lastTradeAt = uint64(block.timestamp);
        c.gradTarget = G;
        // V0 = G * (T0 - S) / S, so the 800M curve tokens sell out exactly when realHYPE = G
        c.virtualHYPE = (G * (VIRTUAL_TOKENS - CURVE_SUPPLY)) / CURVE_SUPPLY;
        allTokens.push(token);
        launchParams[token] = p;
        metadata[token] = meta;
        protocolAccrued += fee;

        uint256 devIn = msg.value - fee;
        uint256 devTokens;
        if (devIn > 0) {
            (uint256 out, uint256 f, uint256 used) = _buyMath(c, devIn, FEE_BPS);
            require(used == devIn, "dev buy too large");
            require(out <= DEV_BUY_MAX, "dev buy > 10%");
            require(out >= devMinOut, "slippage");
            _applyBuy(c, used - f, out);
            _splitFee(c, f, false);
            c.devLocked = out;
            devTokens = out;
            emit Trade(token, msg.sender, true, used, out, f, c.realHYPE, c.tokensSold);
        }
        emit TokenCreated(token, msg.sender, name, symbol, devTokens, p.taxWindow, p.startTaxBps, p.perpMaxLeverage, meta);
        if (bytes(image).length > 0) emit TokenImage(token, image);
    }

    // ------------------------------------------------------------------
    // Curve trading
    // ------------------------------------------------------------------

    function buy(address token, uint256 minOut) external payable nonReentrant returns (uint256 out) {
        Curve storage c = curves[token];
        require(c.state == State.Bonding, "not bonding");
        require(!failable(token), "failed: call markFailed");
        (uint256 bps, bool isTax) = buyFeeBps(token);
        require(bps < BPS, "tax 100%");
        uint256 total = _withCreatorTax(token, bps);
        uint256 fee;
        uint256 used;
        (out, fee, used) = _buyMath(c, msg.value, total);
        require(out > 0 && out >= minOut, "slippage");
        _applyBuy(c, used - fee, out);
        uint256 cTax = (fee * (total - bps)) / total; // the creator's tax share of the fee
        c.creatorClaimable += cTax;
        _splitFee(c, fee - cTax, isTax);
        c.lastTradeAt = uint64(block.timestamp);
        require(IERC20Min(token).transfer(msg.sender, out), "transfer");
        emit Trade(token, msg.sender, true, used, out, fee, c.realHYPE, c.tokensSold);

        if (c.realHYPE >= c.gradTarget) _graduate(token, c);
        if (msg.value > used) _send(msg.sender, msg.value - used);
    }

    /// @notice Sell back to the curve. Still works when the token has Failed (sell-only).
    function sell(address token, uint256 tokensIn, uint256 minOut) external nonReentrant returns (uint256 out) {
        Curve storage c = curves[token];
        require(c.state == State.Bonding || c.state == State.Failed, "closed");
        require(tokensIn > 0, "zero");
        uint256 gross = _sellGross(c, tokensIn);
        uint256 fee = (gross * FEE_BPS) / BPS;
        uint256 cTax = (gross * launchParams[token].creatorTaxBps) / BPS;
        out = gross - fee - cTax;
        require(out >= minOut, "slippage");
        require(IERC20Min(token).transferFrom(msg.sender, address(this), tokensIn), "transferFrom");
        c.realHYPE -= gross;
        c.tokensSold -= tokensIn;
        c.creatorClaimable += cTax;
        _splitFee(c, fee, false);
        c.lastTradeAt = uint64(block.timestamp);
        emit Trade(token, msg.sender, false, gross, tokensIn, fee + cTax, c.realHYPE, c.tokensSold);
        _send(msg.sender, out);
    }

    function markFailed(address token) external {
        Curve storage c = curves[token];
        require(failable(token), "not failable");
        c.state = State.Failed;
        c.creatorClaimable += c.creatorLockedTax + c.escrow;
        c.creatorLockedTax = 0;
        c.escrow = 0;
        emit Failed(token);
    }

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------

    /// @notice Pays the creator's claimable curve fees (and unlocked tax / escrow) to the fee splits.
    /// Anyone can trigger it; funds only go to the creator's chosen recipients.
    function claimCreator(address token) external nonReentrant {
        Curve storage c = curves[token];
        require(c.creator != address(0), "token");
        uint256 amt = c.creatorClaimable;
        require(amt > 0, "nothing");
        c.creatorClaimable = 0;
        _payCreator(token, c.creator, amt);
    }

    /// @notice Called by a token's pool with the creator's spot fees.
    function payCreator(address token) external payable nonReentrant {
        Curve storage c = curves[token];
        require(msg.sender == c.pool && c.pool != address(0), "pool");
        _payCreator(token, c.creator, msg.value);
    }

    /// @notice The creator chooses where their earnings go. Empty arrays reset to "all to the creator".
    function setFeeSplits(address token, address[] calldata to, uint16[] calldata bps) external {
        require(msg.sender == curves[token].creator, "creator");
        require(to.length == bps.length && to.length <= MAX_SPLITS, "splits");
        delete _splits[token];
        uint256 sum;
        for (uint256 i = 0; i < to.length; i++) {
            require(to[i] != address(0) && bps[i] > 0, "split");
            sum += bps[i];
            _splits[token].push(Split(to[i], bps[i]));
        }
        require(to.length == 0 || sum == 10_000, "sum");
        emit FeeSplitsSet(token, to, bps);
    }

    function feeSplits(address token) external view returns (address[] memory to, uint16[] memory bps) {
        Split[] storage s = _splits[token];
        to = new address[](s.length);
        bps = new uint16[](s.length);
        for (uint256 i = 0; i < s.length; i++) (to[i], bps[i]) = (s[i].to, s[i].bps);
    }

    /// @notice Pulls HYPE that could not be pushed to you as a split recipient.
    function withdrawOwed() external nonReentrant {
        uint256 amt = owed[msg.sender];
        require(amt > 0, "nothing");
        owed[msg.sender] = 0;
        _send(msg.sender, amt);
    }

    function _payCreator(address token, address creator, uint256 amt) internal {
        if (amt == 0) return;
        Split[] storage s = _splits[token];
        emit CreatorPaid(token, amt);
        if (s.length == 0) return _push(creator, amt);
        uint256 left = amt;
        for (uint256 i = 0; i < s.length; i++) {
            uint256 part = i == s.length - 1 ? left : (amt * s[i].bps) / 10_000;
            left -= part;
            _push(s[i].to, part);
        }
    }

    /// @dev Never lets one recipient block the others: a failed transfer becomes a pull balance.
    function _push(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt, gas: 50_000}("");
        if (!ok) owed[to] += amt;
    }

    function claimDev(address token) external nonReentrant {
        Curve storage c = curves[token];
        require(msg.sender == c.creator, "creator");
        uint256 amt = devVested(token) - c.devClaimed;
        require(amt > 0, "nothing");
        c.devClaimed += amt;
        require(IERC20Min(token).transfer(msg.sender, amt), "transfer");
    }

    function withdrawProtocol() external nonReentrant {
        uint256 amt = protocolAccrued;
        protocolAccrued = 0;
        _send(config.treasury(), amt);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _buyMath(Curve storage c, uint256 hypeIn, uint256 bps)
        internal
        view
        returns (uint256 out, uint256 fee, uint256 used)
    {
        if (bps >= BPS) return (0, hypeIn, hypeIn);
        used = hypeIn;
        fee = (hypeIn * bps) / BPS;
        uint256 net = hypeIn - fee;
        uint256 room = c.gradTarget - c.realHYPE;
        if (net >= room) {
            net = room;
            used = (net * BPS + (BPS - bps) - 1) / (BPS - bps); // round up
            fee = used - net;
        }
        uint256 vH = c.virtualHYPE + c.realHYPE;
        uint256 vT = VIRTUAL_TOKENS - c.tokensSold;
        out = (vT * net) / (vH + net);
        uint256 left = CURVE_SUPPLY - c.tokensSold;
        if (out > left || net == room) out = left; // the final buy empties the curve
    }

    function _sellGross(Curve storage c, uint256 tokensIn) internal view returns (uint256) {
        uint256 vH = c.virtualHYPE + c.realHYPE;
        uint256 vT = VIRTUAL_TOKENS - c.tokensSold;
        uint256 gross = (vH * tokensIn) / (vT + tokensIn);
        return gross > c.realHYPE ? c.realHYPE : gross;
    }

    function _applyBuy(Curve storage c, uint256 net, uint256 out) internal {
        c.realHYPE += net;
        c.tokensSold += out;
    }

    /// @dev 50% protocol, 25% creator (locked when it is tax), 25% vault escrow.
    function _splitFee(Curve storage c, uint256 fee, bool isTax) internal {
        uint256 proto = fee / 2;
        uint256 creatorPart = fee / 4;
        uint256 esc = fee - proto - creatorPart;
        protocolAccrued += proto;
        if (isTax) c.creatorLockedTax += creatorPart;
        else c.creatorClaimable += creatorPart;
        c.escrow += esc;
    }

    function _graduate(address token, Curve storage c) internal {
        uint256 G = c.gradTarget;
        uint256 poolHYPE = (G * 85) / 100;
        uint256 seed = (G * 10) / 100;
        protocolAccrued += G - poolHYPE - seed; // 5%

        // Pool price = final curve price
        uint256 vH = c.virtualHYPE + c.realHYPE;
        uint256 vT = VIRTUAL_TOKENS - c.tokensSold;
        uint256 poolTokens = (poolHYPE * vT) / vH;

        uint256 devRemaining = c.devLocked; // nothing has been claimed at graduation
        uint256 bal = IERC20Min(token).balanceOf(address(this));
        require(bal >= devRemaining + poolTokens, "reserve");
        uint256 burnAmt = bal - devRemaining - poolTokens;

        c.state = State.Graduated;
        c.gradAt = uint64(block.timestamp);
        c.realHYPE = 0;

        address pool = poolFactory.create{value: poolHYPE}(token, c.creator, poolTokens, launchParams[token].creatorTaxBps);
        require(IERC20Min(token).transfer(pool, poolTokens), "pool tokens");
        if (burnAmt > 0) IERC20Min(token).burn(burnAmt);

        address market = marketFactory.create(token, pool, c.creator, G, launchParams[token].perpMaxLeverage);
        IZephraPool(pool).setMarket(market);

        uint256 esc = c.escrow;
        c.escrow = 0;
        c.creatorClaimable += c.creatorLockedTax;
        c.creatorLockedTax = 0;
        IPerpMarket(market).initVault{value: seed + esc}(seed, esc);

        c.pool = pool;
        c.market = market;
        emit Graduated(token, pool, market, poolHYPE, poolTokens);
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "send");
    }
}
