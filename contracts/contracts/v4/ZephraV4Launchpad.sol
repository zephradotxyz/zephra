// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ZephraTokenV4} from "./ZephraTokenV4.sol";
import {IZephraConfig, IMarketFactory, IPerpMarket, IERC20Min} from "../Interfaces.sol";

interface IZephraPoolView {
    function setMarket(address m) external;
    function pushFee(uint256 devPart) external payable;
}

interface IZephraPoolViewFactory {
    function create(address hook, address token) external returns (address);
}

/// @title ZephraV4Launchpad
/// @notice Token factory AND Uniswap v4 hook in one contract. Every token launches straight into a
///         standard Uniswap v4 pool (HYPE / token) on Elysium's PoolManager: the whole supply is seeded as
///         one permanent single-sided position (no bonding curve, no migration, nobody can remove it).
///         The hook charges the trading fee (in HYPE) on every swap, whichever router is used, runs the
///         anti-sniper tax, the optional creator tax and the price oracle, and "graduates" a token (creates
///         its isolated perp market) once enough HYPE has been paid into the pool.
contract ZephraV4Launchpad is IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 internal constant BPS = 10_000;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant DEV_BUY_MAX = 100_000_000 ether; // 10% of supply
    uint256 public constant DEV_VEST = 3 days;
    uint256 public constant DEV_MAX_LOCK = 30 days; // dev tokens unlock after this even if never graduated
    uint256 public constant TAX_WINDOW = 60;
    uint256 public constant TAX_START_BPS = 10_000;
    uint256 public constant TAX_END_BPS = 200;
    uint256 public constant MIN_TAX_WINDOW = 30;
    uint256 public constant MAX_TAX_WINDOW = 300;
    uint256 public constant MIN_START_TAX_BPS = 1_000;
    uint256 public constant MAX_PERP_LEVERAGE = 3;
    uint256 public constant MAX_CREATOR_TAX_BPS = 1_000;
    uint256 public constant FEE_BPS = 100; // 1% before graduation
    uint256 public constant FEE_BPS_GRADUATED = 200; // 2% after graduation
    uint256 public constant MAX_SPLITS = 5;
    uint256 public constant PROTOCOL_TAX_CUT_BPS = 50; // Zephra keeps 0.5% of trade value out of the creator tax

    /// @dev Opening price: 1B tokens = ~42 HYPE of market cap. The single position spans 49,600 ticks below it.
    int24 public constant TICK_SPACING = 200;
    int24 public constant START_TICK = 169_800;
    int24 public constant LOWER_TICK = 120_200;

    uint256 internal constant OBS_SIZE = 400;
    uint256 internal constant OBS_SPACING = 10;

    uint8 internal constant S_NONE = 0;
    uint8 internal constant S_LIVE = 1; // trading, perp not open yet
    uint8 internal constant S_CROSSED = 2; // reached the target; graduates on the next swap
    uint8 internal constant S_GRADUATED = 3;

    struct LaunchParams {
        uint32 taxWindow;
        uint16 startTaxBps;
        uint8 perpMaxLeverage;
        uint16 creatorTaxBps;
    }

    struct Info {
        address creator;
        uint8 state;
        uint64 createdAt;
        uint64 gradAt;
        uint64 lastTradeAt;
        uint256 gradTarget;
        uint256 netQuote; // HYPE currently inside the pool (net of the hook fee)
        uint256 tokensSold; // tokens currently outside the pool
        uint256 initialReserve; // netQuote at graduation
        uint256 creatorClaimable;
        uint256 creatorLockedTax;
        uint256 escrow;
        uint256 devLocked;
        uint256 devClaimed;
        address adapter;
        address market;
    }

    struct Split {
        address to;
        uint16 bps;
    }

    struct Obs {
        uint64 t;
        uint256 cum;
    }

    struct Oracle {
        uint64 lastCumTime;
        uint256 priceCumulative;
        uint256 obsIndex;
        uint256 obsCount;
    }

    IPoolManager public immutable poolManager;
    IZephraConfig public immutable config;
    IMarketFactory public immutable marketFactory;
    IZephraPoolViewFactory public immutable viewFactory;
    address public immutable tokenImpl;

    mapping(address => Info) public info;
    mapping(address => LaunchParams) public launchParams;
    mapping(address => string) public metadata;
    mapping(address => Split[]) internal _splits;
    mapping(address => uint256) public owed;
    address[] public allTokens;
    mapping(address => address[]) internal _creatorTokens;
    uint256 public protocolAccrued;
    /// @dev Fees are held inside the PoolManager as claims (it has no HYPE to hand out mid-swap) and
    ///      redeemed as real HYPE at the start of the next swap or on demand.
    uint256 public pendingClaims;
    mapping(address => uint256) public vaultOwed;
    mapping(address => uint256) public vaultDevOwed;

    mapping(address => Oracle) internal _oracle;
    mapping(address => Obs[400]) internal _obs;
    mapping(address => uint256[72]) internal _volBucket;
    mapping(address => uint64[72]) internal _volHour;

    uint256 private _lock = 1;

    bytes32 internal constant T_FEE = keccak256("zephra.fee");
    bytes32 internal constant T_TAX = keccak256("zephra.tax");

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
        uint256 netQuote,
        uint256 tokensSold
    );
    event TokenImage(address indexed token, string image);
    event Crossed(address indexed token, uint256 netQuote);
    event Graduated(address indexed token, address pool, address market, uint256 poolHYPE, uint256 poolTokens);
    event FeeSplitsSet(address indexed token, address[] to, uint16[] bps);
    event CreatorPaid(address indexed token, uint256 amount);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyPM() {
        require(msg.sender == address(poolManager), "pool manager");
        _;
    }

    constructor(address poolManager_, address config_, address marketFactory_, address viewFactory_, address tokenImpl_) {
        tokenImpl = tokenImpl_;
        poolManager = IPoolManager(poolManager_);
        config = IZephraConfig(config_);
        marketFactory = IMarketFactory(marketFactory_);
        viewFactory = IZephraPoolViewFactory(viewFactory_);
        _validatePermissions();
    }

    function _validatePermissions() private view {
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: true,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    receive() external payable {}

    /// @dev EIP-1167 minimal proxy: every token is a 45-byte clone of the one verified implementation.
    function _clone(address impl) internal returns (address inst) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            inst := create(0, ptr, 0x37)
        }
        require(inst != address(0), "clone");
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function isInsider(address token, address who) external view returns (bool) {
        return info[token].creator == who;
    }

    function poolKey(address token) public view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    function poolId(address token) public view returns (bytes32) {
        return PoolId.unwrap(poolKey(token).toId());
    }

    /// @notice Current base buy rate (bps) and whether the anti-sniper tax is active.
    function buyFeeBps(address token) public view returns (uint256 bps, bool isTax) {
        Info storage c = info[token];
        LaunchParams storage lp = launchParams[token];
        uint256 base = c.state == S_GRADUATED ? FEE_BPS_GRADUATED : FEE_BPS;
        uint256 t = block.timestamp - c.createdAt;
        if (lp.taxWindow > 0 && t < lp.taxWindow && lp.startTaxBps > base) {
            uint256 drop = ((uint256(lp.startTaxBps) - TAX_END_BPS) * t) / lp.taxWindow;
            uint256 v = uint256(lp.startTaxBps) - drop;
            return (v > TAX_END_BPS ? v : TAX_END_BPS, true);
        }
        return (base, false);
    }

    function sellFeeBps(address token) public view returns (uint256) {
        uint256 base = info[token].state == S_GRADUATED ? FEE_BPS_GRADUATED : FEE_BPS;
        return _cap(base + launchParams[token].creatorTaxBps);
    }

    function _cap(uint256 bps) internal pure returns (uint256) {
        return bps >= BPS ? BPS - 1 : bps;
    }

    function _buyRateOnly(address token) internal view returns (uint256 r) {
        (r,) = _buyRate(token);
    }

    function _buyRate(address token) internal view returns (uint256 rate, bool isTax) {
        (uint256 bps, bool tax) = buyFeeBps(token);
        return (_cap(bps + launchParams[token].creatorTaxBps), tax);
    }

    /// @notice HYPE per token scaled by 1e18 (the inverse of the pool's token-per-HYPE price).
    function spotPrice(address token) public view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(PoolId.wrap(poolId(token)));
        uint256 a = FullMath.mulDiv(1e18, 1 << 96, sqrtP);
        return FullMath.mulDiv(a, 1 << 96, sqrtP);
    }

    /// @notice Liquidity of the single seeded position (constant; the pool's "active" liquidity reads 0 while the
    ///         price sits exactly on the top tick, so quotes use this value instead).
    function liquidity(address) public pure returns (uint128) {
        uint160 sqrtU = TickMath.getSqrtPriceAtTick(START_TICK);
        uint160 sqrtL = TickMath.getSqrtPriceAtTick(LOWER_TICK);
        return uint128(FullMath.mulDiv(SUPPLY, 1 << 96, uint256(sqrtU) - uint256(sqrtL)));
    }

    function devVested(address token) public view returns (uint256) {
        Info storage c = info[token];
        if (c.state == S_GRADUATED) {
            uint256 el = block.timestamp - c.gradAt;
            if (el >= DEV_VEST) return c.devLocked;
            return (c.devLocked * el) / DEV_VEST;
        }
        if (block.timestamp >= c.createdAt + DEV_MAX_LOCK) return c.devLocked;
        return 0;
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    function create(string calldata name, string calldata symbol, uint256 devMinOut) external payable returns (address) {
        return createAdvanced(
            name, symbol, "", "", LaunchParams(uint32(TAX_WINDOW), uint16(TAX_START_BPS), uint8(MAX_PERP_LEVERAGE), 0), devMinOut
        );
    }

    /// @notice Create a token and its Uniswap v4 pool. msg.value = creation fee + optional dev buy
    ///         (max 10% of supply, vests after graduation).
    function createAdvanced(
        string calldata name,
        string calldata symbol,
        string memory meta,
        string memory image,
        LaunchParams memory p,
        uint256 devMinOut
    ) public payable nonReentrant returns (address token) {
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

        token = _clone(tokenImpl);
        ZephraTokenV4(token).initialize(name, symbol, SUPPLY, address(this), meta);
        Info storage c = info[token];
        c.creator = msg.sender;
        c.state = S_LIVE;
        c.createdAt = uint64(block.timestamp);
        c.lastTradeAt = uint64(block.timestamp);
        c.gradTarget = config.gradTarget();
        allTokens.push(token);
        _creatorTokens[msg.sender].push(token);
        launchParams[token] = p;
        metadata[token] = meta;
        protocolAccrued += fee;
        _oracle[token].lastCumTime = uint64(block.timestamp);
        _obs[token][0] = Obs(uint64(block.timestamp), 0);
        _oracle[token].obsCount = 1;

        PoolKey memory key = poolKey(token);
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(START_TICK));
        poolManager.unlock(abi.encode(uint8(1), token, uint256(0)));

        uint256 devIn = msg.value - fee;
        uint256 devTokens;
        if (devIn > 0) {
            bytes memory r = poolManager.unlock(abi.encode(uint8(2), token, devIn));
            devTokens = abi.decode(r, (uint256));
            require(devTokens <= DEV_BUY_MAX, "dev buy > 10%");
            require(devTokens >= devMinOut, "slippage");
            c.devLocked = devTokens;
        }
        emit TokenCreated(token, msg.sender, name, symbol, devTokens, p.taxWindow, p.startTaxBps, p.perpMaxLeverage, meta);
        if (bytes(image).length > 0) emit TokenImage(token, image);
    }

    /// @dev Runs inside PoolManager.unlock: 1 = seed liquidity, 2 = the creator's dev buy.
    function unlockCallback(bytes calldata data) external onlyPM returns (bytes memory) {
        (uint8 action, address token, uint256 amount) = abi.decode(data, (uint8, address, uint256));
        if (action == 3) {
            _redeem();
            return "";
        }
        PoolKey memory key = poolKey(token);
        if (action == 1) {
            uint160 sqrtU = TickMath.getSqrtPriceAtTick(START_TICK);
            uint160 sqrtL = TickMath.getSqrtPriceAtTick(LOWER_TICK);
            uint256 L = FullMath.mulDiv(SUPPLY, 1 << 96, uint256(sqrtU) - uint256(sqrtL));
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key, ModifyLiquidityParams({tickLower: LOWER_TICK, tickUpper: START_TICK, liquidityDelta: int256(L), salt: 0}), ""
            );
            uint256 owe = uint256(uint128(-d.amount1()));
            require(d.amount0() == 0 && owe <= SUPPLY, "seed");
            poolManager.sync(key.currency1);
            require(IERC20Min(token).transfer(address(poolManager), owe), "seed transfer");
            poolManager.settle();
            return "";
        }
        // action 2: dev buy through the pool, paid with msg.value forwarded by createAdvanced
        BalanceDelta delta = poolManager.swap(
            key, SwapParams({zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}), ""
        );
        uint256 pay = uint256(uint128(-delta.amount0()));
        uint256 out = uint256(uint128(delta.amount1()));
        poolManager.settle{value: pay}();
        poolManager.take(key.currency1, address(this), out);
        // The PoolManager never calls a hook for swaps the hook makes itself, so the dev buy is booked here:
        // no fee, but it counts in the pool's HYPE and token totals and is published as a normal Trade.
        Info storage c = info[token];
        c.netQuote += pay;
        c.tokensSold += out;
        _recordVolume(token, pay);
        emit Trade(token, c.creator, true, pay, out, 0, c.netQuote, c.tokensSold);
        return abi.encode(out);
    }

    // ------------------------------------------------------------------
    // Uniswap v4 hook
    // ------------------------------------------------------------------

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view onlyPM returns (bytes4) {
        require(sender == address(this), "only launchpad");
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPM
        returns (bytes4)
    {
        require(sender == address(this), "liquidity is locked");
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("liquidity is locked");
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPM
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address token = Currency.unwrap(key.currency1);
        Info storage c = info[token];
        require(c.state != S_NONE && Currency.unwrap(key.currency0) == address(0), "unknown pool");
        require(params.amountSpecified < 0, "exact input only");
        _redeem();
        if (c.state == S_CROSSED) _graduate(token);
        _flush(token);
        _updateOracle(token);

        if (!params.zeroForOne) return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);

        uint256 rate;
        bool isTax;
        if (sender == address(this)) {
            rate = FEE_BPS; // the creator's own dev buy: base fee only, no anti-sniper, no creator tax
        } else {
            (rate, isTax) = _buyRate(token);
        }
        uint256 fee = (uint256(-params.amountSpecified) * rate) / BPS;
        _tstore(T_FEE, fee);
        _tstore(T_TAX, isTax ? 1 : 0);
        _claimFee(fee);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        external
        onlyPM
        returns (bytes4, int128)
    {
        address token = Currency.unwrap(key.currency1);
        address trader = hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
        if (params.zeroForOne) {
            uint256 fee = _tload(T_FEE);
            bool isTax = _tload(T_TAX) == 1;
            uint256 net = uint256(uint128(-delta.amount0()));
            // the whole input must have been used: refuse a partial fill (price range exhausted)
            require(net + fee + 1 >= uint256(-params.amountSpecified), "range exhausted");
            _account(token, trader, true, net + fee, uint256(uint128(delta.amount1())), fee, isTax, sender == address(this));
            return (IHooks.afterSwap.selector, 0);
        }
        uint256 gross = uint256(uint128(delta.amount0()));
        uint256 fee2 = (gross * sellFeeBps(token)) / BPS;
        _claimFee(fee2);
        _account(token, trader, false, gross, uint256(uint128(-delta.amount1())), fee2, false, false);
        return (IHooks.afterSwap.selector, int128(int256(fee2)));
    }

    function _account(address token, address trader, bool isBuy, uint256 hype, uint256 tokens, uint256 fee, bool isTax, bool dev)
        internal
    {
        Info storage c = info[token];
        c.lastTradeAt = uint64(block.timestamp);
        _recordVolume(token, hype);
        if (isBuy) {
            c.netQuote += hype - fee;
            c.tokensSold += tokens;
        } else {
            c.netQuote -= hype;
            c.tokensSold -= tokens;
        }
        _splitFee(token, fee, isTax, isBuy, dev);
        if (c.state == S_LIVE && c.netQuote >= c.gradTarget) {
            c.state = S_CROSSED;
            emit Crossed(token, c.netQuote);
        }
        emit Trade(token, trader, isBuy, hype, tokens, fee, c.netQuote, c.tokensSold);
    }

    /// @dev Pre-graduation 1%: 50% Zephra, 25% creator (locked while it is anti-sniper tax), 25% vault escrow.
    ///      After graduation 2%: 37.5% creator, 37.5% perp vault, 25% Zephra. The creator tax is 100% creator.
    function _splitFee(address token, uint256 fee, bool isTax, bool isBuy, bool dev) internal {
        if (fee == 0) return;
        Info storage c = info[token];
        LaunchParams storage lp = launchParams[token];
        uint256 tax;
        if (!dev) {
            uint256 rate;
            if (isBuy) (rate,) = _buyRate(token);
            else rate = sellFeeBps(token);
            if (lp.creatorTaxBps > 0 && rate > 0) tax = (fee * lp.creatorTaxBps) / rate;
            if (tax > fee) tax = fee;
        }
        uint256 f = fee - tax;
        if (tax > 0) {
            // Zephra's automatic cut: 0.5% of the trade value, taken from the creator's tax (never more than the tax)
            uint256 rate2 = isBuy ? _buyRateOnly(token) : sellFeeBps(token);
            uint256 cut = (fee * PROTOCOL_TAX_CUT_BPS) / rate2;
            if (cut > tax) cut = tax;
            protocolAccrued += cut;
            tax -= cut;
        }
        c.creatorClaimable += tax;
        if (c.state != S_GRADUATED) {
            uint256 proto = f / 2;
            uint256 cp = f / 4;
            protocolAccrued += proto;
            if (isTax) c.creatorLockedTax += cp;
            else c.creatorClaimable += cp;
            c.escrow += f - proto - cp;
        } else {
            uint256 cr = (f * 3) / 8;
            uint256 devp = f / 4;
            uint256 lpp = f / 8;
            c.creatorClaimable += cr;
            protocolAccrued += f - cr - devp - lpp;
            vaultOwed[token] += devp + lpp;
            vaultDevOwed[token] += devp;
        }
    }

    function _claimFee(uint256 fee) internal {
        if (fee == 0) return;
        poolManager.mint(address(this), 0, fee);
        pendingClaims += fee;
    }

    /// @dev Inside an unlock: turn pending claims into real HYPE held by this contract.
    function _redeem() internal {
        uint256 p = pendingClaims;
        if (p == 0) return;
        pendingClaims = 0;
        poolManager.burn(address(this), 0, p);
        poolManager.take(Currency.wrap(address(0)), address(this), p);
    }

    function _redeemOutside() internal {
        if (pendingClaims > 0) poolManager.unlock(abi.encode(uint8(3), address(0), uint256(0)));
    }

    function _flush(address token) internal {
        uint256 amt = vaultOwed[token];
        address adapter = info[token].adapter;
        if (amt == 0 || adapter == address(0)) return;
        uint256 devp = vaultDevOwed[token];
        vaultOwed[token] = 0;
        vaultDevOwed[token] = 0;
        try IZephraPoolView(adapter).pushFee{value: amt}(devp) {}
        catch {
            protocolAccrued += amt;
        }
    }

    /// @notice Sends the perp vault's share of fees to the market. Anyone can call it.
    function flushVault(address token) external nonReentrant {
        _redeemOutside();
        _flush(token);
    }

    // ------------------------------------------------------------------
    // Graduation
    // ------------------------------------------------------------------

    /// @notice Opens the token's perp market once its pool has taken in the graduation target.
    ///         Called automatically by the next swap; anyone can also call it.
    function graduate(address token) external nonReentrant {
        require(info[token].state == S_CROSSED, "not ready");
        _redeemOutside();
        _graduate(token);
    }

    function _graduate(address token) internal {
        Info storage c = info[token];
        c.state = S_GRADUATED;
        c.gradAt = uint64(block.timestamp);
        c.initialReserve = c.netQuote;
        address adapter = viewFactory.create(address(this), token);
        address market = marketFactory.create(token, adapter, c.creator, c.gradTarget, launchParams[token].perpMaxLeverage);
        IZephraPoolView(adapter).setMarket(market);
        uint256 esc = c.escrow;
        c.escrow = 0;
        c.creatorClaimable += c.creatorLockedTax;
        c.creatorLockedTax = 0;
        c.adapter = adapter;
        c.market = market;
        IPerpMarket(market).initVault{value: esc}(0, esc);
        emit Graduated(token, adapter, market, c.netQuote, SUPPLY - c.tokensSold);
    }

    // ------------------------------------------------------------------
    // Oracle + volume (read by each token's perp market through its pool view)
    // ------------------------------------------------------------------

    function reserveOf(address token) external view returns (uint256) {
        return info[token].netQuote;
    }

    function initialReserveOf(address token) external view returns (uint256) {
        return info[token].initialReserve;
    }

    function poke(address token) external {
        _updateOracle(token);
    }

    function _updateOracle(address token) internal {
        Oracle storage o = _oracle[token];
        uint64 nowT = uint64(block.timestamp);
        if (nowT > o.lastCumTime) {
            o.priceCumulative += spotPrice(token) * (nowT - o.lastCumTime);
            o.lastCumTime = nowT;
            if (nowT - _obs[token][o.obsIndex].t >= OBS_SPACING) {
                o.obsIndex = (o.obsIndex + 1) % OBS_SIZE;
                _obs[token][o.obsIndex] = Obs(nowT, o.priceCumulative);
                if (o.obsCount < OBS_SIZE) o.obsCount++;
            }
        }
    }

    function _cumNow(address token) internal view returns (uint256) {
        Oracle storage o = _oracle[token];
        return o.priceCumulative + spotPrice(token) * (block.timestamp - o.lastCumTime);
    }

    function _obsLogical(address token, uint256 i) internal view returns (Obs memory) {
        Oracle storage o = _oracle[token];
        uint256 start = o.obsCount < OBS_SIZE ? 0 : (o.obsIndex + 1) % OBS_SIZE;
        return _obs[token][(start + i) % OBS_SIZE];
    }

    function _obsAtOrBefore(address token, uint256 target) internal view returns (Obs memory) {
        Obs memory oldest = _obsLogical(token, 0);
        if (target <= oldest.t) return oldest;
        uint256 lo = 0;
        uint256 hi = _oracle[token].obsCount - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_obsLogical(token, mid).t <= target) lo = mid;
            else hi = mid - 1;
        }
        return _obsLogical(token, lo);
    }

    /// @notice Time-weighted price over a window (seconds), HYPE per token x 1e18.
    function twapOf(address token, uint256 window) external view returns (uint256) {
        if (window == 0) return spotPrice(token);
        uint256 target = block.timestamp > window ? block.timestamp - window : 0;
        Obs memory o = _obsAtOrBefore(token, target);
        if (o.t >= block.timestamp) return spotPrice(token);
        return (_cumNow(token) - o.cum) / (block.timestamp - o.t);
    }

    function _recordVolume(address token, uint256 hype) internal {
        uint64 h = uint64(block.timestamp / 1 hours);
        uint256 i = h % 72;
        if (_volHour[token][i] != h) {
            _volHour[token][i] = h;
            _volBucket[token][i] = 0;
        }
        _volBucket[token][i] += hype;
    }

    function volume72hOf(address token) external view returns (uint256 v) {
        uint64 h = uint64(block.timestamp / 1 hours);
        for (uint256 i = 0; i < 72; i++) {
            if (_volHour[token][i] + 72 > h) v += _volBucket[token][i];
        }
    }

    // ------------------------------------------------------------------
    // Creator earnings and fee splits
    // ------------------------------------------------------------------

    function setFeeSplits(address token, address[] calldata to, uint16[] calldata bps) external {
        require(msg.sender == info[token].creator, "creator");
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

    function creatorTokenCount(address creator) external view returns (uint256) {
        return _creatorTokens[creator].length;
    }

    function creatorTokenAt(address creator, uint256 i) external view returns (address) {
        return _creatorTokens[creator][i];
    }

    /// @notice Total fees waiting for a creator across every token they launched.
    function creatorClaimableTotal(address creator) external view returns (uint256 total) {
        address[] storage list = _creatorTokens[creator];
        for (uint256 i = 0; i < list.length; i++) total += info[list[i]].creatorClaimable;
    }

    /// @notice Pays the creator's claimable fees for one token to the creator's chosen recipients. Anyone can trigger it.
    ///         The same call also sends the protocol's accrued share to the treasury and tops up this token's perp vault.
    function claimCreator(address token) external nonReentrant {
        Info storage c = info[token];
        require(c.creator != address(0), "token");
        _redeemOutside();
        uint256 amt = c.creatorClaimable;
        require(amt > 0, "nothing");
        c.creatorClaimable = 0;
        _payCreator(token, c.creator, amt);
        _flush(token);
        _sweepProtocol();
    }

    /// @notice Claims one creator's fees on all their tokens in a single transaction (tokens [from, to) of their list,
    ///         so a creator with many launches can split it into batches). Each token's fees go to that token's
    ///         recipients. Also tops up the perp vaults and sends the protocol share to the treasury.
    function claimAll(address creator, uint256 from, uint256 to) external nonReentrant returns (uint256 paid) {
        address[] storage list = _creatorTokens[creator];
        if (to > list.length) to = list.length;
        require(from < to, "range");
        _redeemOutside();
        for (uint256 i = from; i < to; i++) {
            address token = list[i];
            Info storage c = info[token];
            uint256 amt = c.creatorClaimable;
            if (amt > 0) {
                c.creatorClaimable = 0;
                paid += amt;
                _payCreator(token, creator, amt);
            }
            _flush(token);
        }
        require(paid > 0, "nothing");
        _sweepProtocol();
    }

    /// @dev Sends the protocol's accrued share to the treasury. Never reverts: if the treasury cannot receive it,
    ///      the amount stays accrued.
    function _sweepProtocol() internal {
        uint256 a = protocolAccrued;
        if (a == 0) return;
        protocolAccrued = 0;
        (bool ok,) = config.treasury().call{value: a}("");
        if (!ok) protocolAccrued = a;
    }

    function claimDev(address token) external nonReentrant {
        Info storage c = info[token];
        require(msg.sender == c.creator, "creator");
        uint256 amt = devVested(token) - c.devClaimed;
        require(amt > 0, "nothing");
        c.devClaimed += amt;
        require(IERC20Min(token).transfer(msg.sender, amt), "transfer");
    }

    function withdrawOwed() external nonReentrant {
        uint256 amt = owed[msg.sender];
        require(amt > 0, "nothing");
        owed[msg.sender] = 0;
        _send(msg.sender, amt);
    }

    function withdrawProtocol() external nonReentrant {
        _redeemOutside();
        uint256 amt = protocolAccrued;
        protocolAccrued = 0;
        _send(config.treasury(), amt);
    }

    function _payCreator(address token, address creator, uint256 amt) internal {
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

    function _push(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok,) = to.call{value: amt, gas: 50_000}("");
        if (!ok) owed[to] += amt;
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok,) = to.call{value: amt}("");
        require(ok, "send");
    }

    function _tstore(bytes32 slot, uint256 v) private {
        assembly {
            tstore(slot, v)
        }
    }

    function _tload(bytes32 slot) private view returns (uint256 v) {
        assembly {
            v := tload(slot)
        }
    }
}
