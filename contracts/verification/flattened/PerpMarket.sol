// Sources flattened with hardhat v2.29.1 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/Interfaces.sol

// Original license: SPDX_License_Identifier: MIT
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
    function create(address token, address creator, uint256 tokenAmount) external payable returns (address);
}

interface IMarketFactory {
    function create(address token, address pool, address creator, uint256 gradTarget, uint8 maxLeverage) external returns (address);
}


// File contracts/PerpMarket.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity 0.8.26;

/// @title PerpMarket
/// @notice Isolated TOKEN/HYPE perp market + Perp Vault for a single token.
///  - The vault (HYPE) is the counterparty to traders. NAV includes open-position PnL (60s TWAP).
///  - Pessimistic execution price: the worse of spot and the 180s TWAP, plus impact.
///  - OI per side <= min(50% of NAV, 25% of pool HYPE). Max profit is 2/3 of notional.
///  - 2x leverage for the first 24 hours, then 3x. Liquidation when equity < 10% of notional.
///  - States: WarmUp -> Active <-> CloseOnly -> Closed. Grace period after a sequencer outage.
contract PerpMarket {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    // Parameters (see spec)
    uint256 public constant WARMUP = 30 minutes;
    uint256 public constant LOW_LEV_PERIOD = 24 hours;
    uint256 public constant TWAP_EXEC = 180;
    uint256 public constant TWAP_MARK = 60;
    uint256 public constant TWAP_SETTLE = 3600;
    uint256 public constant MAX_DEVIATION_BPS = 300;
    uint256 public constant MAX_IMPACT_BPS = 50;
    uint256 public constant FEE_BPS = 50; // open/close
    uint256 public constant FEE_VAULT_BPS = 30;
    uint256 public constant FEE_PROTO_BPS = 20;
    uint256 public constant MAINT_BPS = 1000; // 10%
    uint256 public constant LIQ_REWARD_BPS = 100; // 1%
    uint256 public constant WALLET_CAP_BPS = 2000; // 20% of the per-side cap
    uint256 public constant MAX_FUNDING_PER_SEC = uint256(1e15) / 3600; // 0.1% per hour
    uint256 public constant LP_COOLDOWN = 1 hours;
    uint256 public constant CLOSE_ONLY_PERIOD = 72 hours;
    uint256 public constant HEARTBEAT_GAP = 60;
    uint256 public constant GRACE = 10 minutes;

    enum State {
        WarmUp,
        Active,
        CloseOnly,
        Closed
    }

    struct Position {
        uint256 margin;
        uint256 notional; // HYPE
        uint256 size; // tokens (notional / entry price)
        int256 fundSnap;
        uint64 openedAt;
    }

    struct Side {
        uint256 notional;
        uint256 size;
        int256 sumSnap; // sum(notional * snap) / WAD
    }

    struct WithdrawReq {
        uint256 shares;
        uint64 readyAt;
    }

    IZephraConfig public immutable config;
    IZephraPool public immutable pool;
    address public immutable token;
    address public immutable creator;
    address public immutable factory;
    uint256 public immutable gradTarget;
    uint64 public immutable gradAt;
    uint64 public immutable activeAt;
    uint256 public immutable leverageCap; // set by the creator at launch (1-3x)

    State internal _state;
    uint64 public closeOnlyAt;
    uint256 public settlementPrice;

    // Vault
    uint256 public vaultCash;
    uint256 public totalShares;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public lockedShares;
    mapping(address => WithdrawReq) public withdrawReq;
    bool public vaultInitialized;

    // Perp
    mapping(address => mapping(bool => Position)) internal _pos;
    Side public longSide;
    Side public shortSide;
    int256 public fundIdxLong;
    int256 public fundIdxShort;
    uint64 public lastAccrue;
    uint256 public totalMargin;
    uint256 public positionCount;
    uint256 public protocolAccrued;

    // Sequencer
    uint64 public lastHeartbeat;
    uint64 public graceUntil;

    uint256 private _lock = 1;

    event VaultInit(uint256 seed, uint256 escrow);
    event Deposit(address indexed lp, uint256 amount, uint256 shares);
    event WithdrawRequested(address indexed lp, uint256 shares, uint64 readyAt);
    event Withdraw(address indexed lp, uint256 amount, uint256 sharesBurned, uint256 sharesLeft);
    event SpotFee(uint256 devPart, uint256 lpPart, uint256 devShares);
    event Open(address indexed trader, bool isLong, uint256 margin, uint256 notional, uint256 price);
    event Close(address indexed trader, bool isLong, uint256 price, int256 pnl, uint256 payout, uint8 kind);
    event StateChanged(State state);
    event Grace(uint64 until);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address config_, address pool_, address token_, address creator_, uint256 gradTarget_, uint8 leverageCap_) {
        leverageCap = leverageCap_;
        config = IZephraConfig(config_);
        pool = IZephraPool(pool_);
        token = token_;
        creator = creator_;
        factory = msg.sender;
        gradTarget = gradTarget_;
        gradAt = uint64(block.timestamp);
        activeAt = uint64(block.timestamp + WARMUP);
        lastAccrue = uint64(block.timestamp);
        lastHeartbeat = uint64(block.timestamp);
    }

    // ==================================================================
    // Views
    // ==================================================================

    function state() public view returns (State) {
        if (_state == State.WarmUp && block.timestamp >= activeAt) return State.Active;
        return _state;
    }

    /// @notice 2x during the first 24 hours, then 3x — never above the creator's cap.
    function maxLeverage() public view returns (uint256) {
        uint256 l = block.timestamp < activeAt + LOW_LEV_PERIOD ? 2 : 3;
        return l < leverageCap ? l : leverageCap;
    }

    function getPosition(address trader, bool isLong) external view returns (Position memory) {
        return _pos[trader][isLong];
    }

    /// @notice Funding rate per second (WAD, signed). Positive = longs pay.
    function fundingRate() public view returns (int256) {
        uint256 cap = _fundingCap();
        if (cap == 0) return 0;
        int256 skew = int256(longSide.notional) - int256(shortSide.notional);
        int256 r = (int256(MAX_FUNDING_PER_SEC) * skew) / int256(cap);
        int256 m = int256(MAX_FUNDING_PER_SEC);
        if (r > m) r = m;
        if (r < -m) r = -m;
        return r;
    }

    function _fundingCap() internal view returns (uint256) {
        uint256 a = vaultCash / 2;
        uint256 b = pool.reserveHYPE() / 4;
        return a < b ? a : b;
    }

    function _pendingIdx() internal view returns (int256 iL, int256 iS) {
        iL = fundIdxLong;
        iS = fundIdxShort;
        uint256 dt = block.timestamp - lastAccrue;
        if (dt == 0 || _state == State.Closed) return (iL, iS);
        int256 r = fundingRate();
        if (r == 0) return (iL, iS);
        int256 d = r * int256(dt);
        if (r > 0) {
            iL += d;
            if (shortSide.notional > 0) {
                int256 paid = (int256(longSide.notional) * d) / int256(WAD);
                iS -= (paid * int256(WAD)) / 2 / int256(shortSide.notional);
            }
        } else {
            iS -= d; // negative d -> shorts pay
            if (longSide.notional > 0) {
                int256 paid = (int256(shortSide.notional) * (-d)) / int256(WAD);
                iL -= (paid * int256(WAD)) / 2 / int256(longSide.notional);
            }
        }
    }

    function markPrice() public view returns (uint256) {
        if (_state == State.Closed) return settlementPrice;
        return pool.twap(TWAP_MARK);
    }

    /// @notice Vault NAV = cash + unsettled funding - unrealized trader PnL.
    function nav() public view returns (uint256) {
        (int256 iL, int256 iS) = _pendingIdx();
        uint256 p = markPrice();
        int256 v = int256(vaultCash);
        v += (int256(longSide.notional) * iL) / int256(WAD) - longSide.sumSnap;
        v += (int256(shortSide.notional) * iS) / int256(WAD) - shortSide.sumSnap;
        int256 pnlL = int256((longSide.size * p) / WAD) - int256(longSide.notional);
        int256 pnlS = int256(shortSide.notional) - int256((shortSide.size * p) / WAD);
        int256 capL = int256((longSide.notional * 2) / 3);
        int256 capS = int256((shortSide.notional * 2) / 3);
        if (pnlL > capL) pnlL = capL;
        if (pnlS > capS) pnlS = capS;
        v -= pnlL + pnlS;
        return v > 0 ? uint256(v) : 0;
    }

    function capPerSide() public view returns (uint256) {
        uint256 a = nav() / 2;
        uint256 b = pool.reserveHYPE() / 4;
        return a < b ? a : b;
    }

    function reserved() public view returns (uint256) {
        uint256 m = longSide.notional > shortSide.notional ? longSide.notional : shortSide.notional;
        return (m * 2) / 3;
    }

    function freeLiquidity() public view returns (uint256) {
        uint256 n = nav();
        uint256 r = state() == State.Closed ? 0 : reserved();
        uint256 f = n > r ? n - r : 0;
        return f < vaultCash ? f : vaultCash;
    }

    function sharePrice() external view returns (uint256) {
        if (totalShares == 0) return WAD;
        return (nav() * WAD) / totalShares;
    }

    /// @notice Pessimistic execution price for opens/closes.
    function execPrice(bool isLong, bool opening, uint256 notional) public view returns (uint256) {
        uint256 s = pool.spotPrice();
        uint256 t = pool.twap(TWAP_EXEC);
        uint256 cap = capPerSide();
        uint256 impact = cap == 0 ? MAX_IMPACT_BPS : (MAX_IMPACT_BPS * notional) / cap;
        if (impact > MAX_IMPACT_BPS) impact = MAX_IMPACT_BPS;
        bool high = (isLong == opening); // opening a long / closing a short -> high price
        if (high) {
            uint256 base = s > t ? s : t;
            return (base * (BPS + impact)) / BPS;
        } else {
            uint256 base = s < t ? s : t;
            return (base * (BPS - impact)) / BPS;
        }
    }

    function deviationBps() public view returns (uint256) {
        uint256 s = pool.spotPrice();
        uint256 t = pool.twap(TWAP_EXEC);
        uint256 d = s > t ? s - t : t - s;
        return (d * BPS) / t;
    }

    /// @notice PnL (capped at 2/3 of notional) and funding owed for a position at price p.
    function positionPnl(address trader, bool isLong, uint256 p) public view returns (int256 pnl, int256 owed) {
        Position memory ps = _pos[trader][isLong];
        if (ps.notional == 0) return (0, 0);
        int256 value = int256((ps.size * p) / WAD);
        pnl = isLong ? value - int256(ps.notional) : int256(ps.notional) - value;
        int256 cap = int256((ps.notional * 2) / 3);
        if (pnl > cap) pnl = cap;
        (int256 iL, int256 iS) = _pendingIdx();
        int256 idx = isLong ? iL : iS;
        owed = (int256(ps.notional) * idx) / int256(WAD) - (int256(ps.notional) * ps.fundSnap) / int256(WAD);
    }

    function isLiquidatable(address trader, bool isLong) public view returns (bool) {
        Position memory ps = _pos[trader][isLong];
        if (ps.notional == 0) return false;
        (int256 pnl, int256 owed) = positionPnl(trader, isLong, markPrice());
        int256 equity = int256(ps.margin) + pnl - owed - int256((ps.notional * FEE_BPS) / BPS);
        return equity < int256((ps.notional * MAINT_BPS) / BPS);
    }

    function atProfitCap(address trader, bool isLong) public view returns (bool) {
        Position memory ps = _pos[trader][isLong];
        if (ps.notional == 0) return false;
        uint256 p = execPrice(isLong, false, ps.notional);
        int256 value = int256((ps.size * p) / WAD);
        int256 raw = isLong ? value - int256(ps.notional) : int256(ps.notional) - value;
        return raw >= int256((ps.notional * 2) / 3);
    }

    // ==================================================================
    // Internal: heartbeat, funding, status
    // ==================================================================

    function _heartbeat() internal {
        if (block.timestamp - lastHeartbeat > HEARTBEAT_GAP) {
            graceUntil = uint64(block.timestamp + GRACE);
            emit Grace(graceUntil);
        }
        lastHeartbeat = uint64(block.timestamp);
    }

    function _accrue() internal {
        (fundIdxLong, fundIdxShort) = _pendingIdx();
        lastAccrue = uint64(block.timestamp);
        if (_state == State.WarmUp && block.timestamp >= activeAt) {
            _state = State.Active;
            emit StateChanged(State.Active);
        }
    }

    /// @notice Anyone / keeper: heartbeat + oracle update + funding accrual.
    function poke() external {
        _heartbeat();
        pool.poke();
        _accrue();
    }

    /// @notice Anyone / keeper: check the close-only, recovery and closed conditions.
    function checkStatus() external {
        _accrue();
        State s = _state;
        bool weak = _isWeak();
        if (s == State.Active && weak) {
            _state = State.CloseOnly;
            closeOnlyAt = uint64(block.timestamp);
            emit StateChanged(State.CloseOnly);
        } else if (s == State.CloseOnly) {
            if (!weak) {
                _state = State.Active;
                emit StateChanged(State.Active);
            } else if (block.timestamp >= closeOnlyAt + CLOSE_ONLY_PERIOD) {
                settlementPrice = pool.twap(TWAP_SETTLE);
                _state = State.Closed;
                emit StateChanged(State.Closed);
            }
        }
    }

    function _isWeak() internal view returns (bool) {
        bool thinPool = pool.reserveHYPE() < (pool.initialReserveHYPE() * 30) / 100;
        bool lowVol = block.timestamp >= activeAt + CLOSE_ONLY_PERIOD && pool.volume72h() < gradTarget / 100;
        return thinPool || lowVol;
    }

    // ==================================================================
    // Vault
    // ==================================================================

    function initVault(uint256 seed, uint256 escrow) external payable {
        require(!vaultInitialized, "init");
        require(msg.sender == IMarketFactoryLp(factory).launchpad(), "launchpad");
        require(msg.value == seed + escrow, "value");
        vaultInitialized = true;
        address t = config.treasury();
        shares[t] += seed;
        lockedShares[t] += seed;
        shares[creator] += escrow;
        lockedShares[creator] += escrow;
        totalShares = seed + escrow;
        vaultCash = msg.value;
        emit VaultInit(seed, escrow);
    }

    /// @notice From the pool: dev share (minted as locked creator shares) + LP income.
    function receiveSpotFee(uint256 devPart) external payable {
        require(msg.sender == address(pool), "pool");
        uint256 n = nav();
        uint256 newSh = (totalShares == 0 || n == 0) ? devPart : (devPart * totalShares) / n;
        shares[creator] += newSh;
        lockedShares[creator] += newSh;
        totalShares += newSh;
        vaultCash += msg.value;
        emit SpotFee(devPart, msg.value - devPart, newSh);
    }

    function deposit() external payable nonReentrant returns (uint256 sh) {
        require(msg.value > 0, "zero");
        _heartbeat();
        _accrue();
        State s = _state;
        require(s == State.WarmUp || s == State.Active, "deposits closed");
        uint256 n = nav();
        if (config.guardedLaunch()) require(n + msg.value <= gradTarget * 5, "guarded cap");
        sh = (totalShares == 0 || n == 0) ? msg.value : (msg.value * totalShares) / n;
        require(sh > 0, "zero shares");
        shares[msg.sender] += sh;
        totalShares += sh;
        vaultCash += msg.value;
        emit Deposit(msg.sender, msg.value, sh);
    }

    function availableShares(address lp) public view returns (uint256) {
        uint256 locked = state() == State.Closed ? 0 : lockedShares[lp];
        uint256 used = locked + withdrawReq[lp].shares;
        return shares[lp] > used ? shares[lp] - used : 0;
    }

    /// @notice Request a withdrawal. Shares stay exposed to gains and losses during the 1-hour cooldown.
    function requestWithdraw(uint256 sh) external {
        require(sh > 0 && sh <= availableShares(msg.sender), "shares");
        WithdrawReq storage w = withdrawReq[msg.sender];
        w.shares += sh;
        w.readyAt = uint64(state() == State.Closed ? block.timestamp : block.timestamp + LP_COOLDOWN);
        emit WithdrawRequested(msg.sender, w.shares, w.readyAt);
    }

    function cancelWithdraw() external {
        delete withdrawReq[msg.sender];
        emit WithdrawRequested(msg.sender, 0, 0);
    }

    /// @notice Execute a withdrawal at the NAV at execution time. Only from free liquidity; the rest stays queued.
    function executeWithdraw(address lp) external nonReentrant {
        _heartbeat();
        _accrue();
        WithdrawReq storage w = withdrawReq[lp];
        require(w.shares > 0, "no request");
        require(block.timestamp >= w.readyAt, "cooldown");
        if (_state == State.Closed) require(positionCount == 0, "settle positions first");
        uint256 n = nav();
        uint256 amt = (w.shares * n) / totalShares;
        uint256 free = freeLiquidity();
        uint256 burnSh = w.shares;
        if (amt > free) {
            burnSh = (w.shares * free) / amt;
            amt = free;
        }
        require(burnSh > 0 && amt > 0, "no free liquidity");
        w.shares -= burnSh;
        shares[lp] -= burnSh;
        totalShares -= burnSh;
        if (lockedShares[lp] > shares[lp]) lockedShares[lp] = shares[lp];
        vaultCash -= amt;
        uint256 left = w.shares;
        if (left == 0) delete withdrawReq[lp];
        emit Withdraw(lp, amt, burnSh, left);
        _send(lp, amt);
    }

    // ==================================================================
    // Perp
    // ==================================================================

    /// @notice Open a position. msg.value = margin + fee (0.5% of notional).
    function open(bool isLong, uint256 notional) external payable nonReentrant {
        _heartbeat();
        pool.poke();
        _accrue();
        require(_state == State.Active, "not active");
        require(!config.perpOpenPaused(), "paused");
        require(block.timestamp >= graceUntil, "grace period");
        require(msg.sender != creator, "insider");
        require(notional > 0, "zero");
        Position storage ps = _pos[msg.sender][isLong];
        require(ps.notional == 0, "position exists");
        require(deviationBps() <= MAX_DEVIATION_BPS, "price deviation");

        uint256 fee = (notional * FEE_BPS) / BPS;
        require(msg.value > fee, "margin");
        uint256 margin = msg.value - fee;
        require(notional <= margin * maxLeverage(), "leverage");

        uint256 cap = capPerSide();
        Side storage sd = isLong ? longSide : shortSide;
        require(sd.notional + notional <= cap, "OI cap");
        require(notional <= (cap * WALLET_CAP_BPS) / BPS, "wallet cap");
        {
            uint256 l = longSide.notional + (isLong ? notional : 0);
            uint256 s = shortSide.notional + (isLong ? 0 : notional);
            uint256 res = ((l > s ? l : s) * 2) / 3;
            require(res <= (nav() * 8000) / BPS, "reduce-only");
        }

        uint256 price = execPrice(isLong, true, notional);
        uint256 size = (notional * WAD) / price;
        int256 idx = isLong ? fundIdxLong : fundIdxShort;

        uint256 protoFee = (notional * FEE_PROTO_BPS) / BPS;
        protocolAccrued += protoFee;
        vaultCash += fee - protoFee;

        sd.notional += notional;
        sd.size += size;
        sd.sumSnap += (int256(notional) * idx) / int256(WAD);
        _pos[msg.sender][isLong] = Position(margin, notional, size, idx, uint64(block.timestamp));
        totalMargin += margin;
        positionCount++;
        emit Open(msg.sender, isLong, margin, notional, price);
    }

    function addMargin(bool isLong) external payable nonReentrant {
        Position storage ps = _pos[msg.sender][isLong];
        require(ps.notional > 0, "no position");
        ps.margin += msg.value;
        totalMargin += msg.value;
    }

    function close(bool isLong) external nonReentrant {
        _heartbeat();
        pool.poke();
        _accrue();
        require(_state != State.Closed, "use settle");
        Position memory ps = _pos[msg.sender][isLong];
        require(ps.notional > 0, "no position");
        uint256 p = execPrice(isLong, false, ps.notional);
        _close(msg.sender, isLong, p, true, 0);
    }

    /// @notice Auto-close when profit reaches the 2/3-of-notional cap. Anyone can trigger it.
    function forceCloseAtCap(address trader, bool isLong) external nonReentrant {
        _heartbeat();
        pool.poke();
        _accrue();
        require(_state != State.Closed, "use settle");
        require(atProfitCap(trader, isLong), "not at cap");
        uint256 p = execPrice(isLong, false, _pos[trader][isLong].notional);
        _close(trader, isLong, p, true, 1);
    }

    function liquidate(address trader, bool isLong) external nonReentrant {
        _heartbeat();
        pool.poke();
        _accrue();
        require(_state != State.Closed, "use settle");
        require(block.timestamp >= graceUntil, "grace period");
        require(isLiquidatable(trader, isLong), "healthy");
        Position memory ps = _pos[trader][isLong];
        (int256 pnl, int256 owed) = positionPnl(trader, isLong, markPrice());
        int256 equity = int256(ps.margin) + pnl - owed - int256((ps.notional * FEE_BPS) / BPS);
        uint256 reward = equity > 0 ? uint256(equity) : 0;
        uint256 maxR = (ps.notional * LIQ_REWARD_BPS) / BPS;
        if (reward > maxR) reward = maxR;
        _removePosition(trader, isLong, ps);
        vaultCash += ps.margin - reward;
        emit Close(trader, isLong, markPrice(), pnl, 0, 2);
        _send(msg.sender, reward);
    }

    /// @notice After Closed: settle a position at the settlement price (1-hour TWAP), with no fee.
    function settle(address trader, bool isLong) external nonReentrant {
        require(_state == State.Closed, "not closed");
        Position memory ps = _pos[trader][isLong];
        require(ps.notional > 0, "no position");
        _close(trader, isLong, settlementPrice, false, 3);
    }

    function _close(address trader, bool isLong, uint256 p, bool withFee, uint8 kind) internal {
        Position memory ps = _pos[trader][isLong];
        (int256 pnl, int256 owed) = positionPnl(trader, isLong, p);
        int256 equity = int256(ps.margin) + pnl - owed;
        uint256 fee = withFee ? (ps.notional * FEE_BPS) / BPS : 0;
        uint256 protoFee = 0;
        if (withFee && equity > 0) {
            protoFee = (ps.notional * FEE_PROTO_BPS) / BPS;
            if (int256(protoFee) > equity) protoFee = uint256(equity);
        }
        int256 payoutI = equity - int256(fee);
        uint256 payout = payoutI > 0 ? uint256(payoutI) : 0;

        _removePosition(trader, isLong, ps);
        protocolAccrued += protoFee;

        // Vault cash changes by margin - payout - protoFee
        int256 delta = int256(ps.margin) - int256(payout) - int256(protoFee);
        if (delta >= 0) {
            vaultCash += uint256(delta);
        } else {
            uint256 need = uint256(-delta);
            if (need > vaultCash) {
                // Vault is short: pay what it can and move the market to close-only
                payout -= need - vaultCash;
                need = vaultCash;
                if (_state == State.Active) {
                    _state = State.CloseOnly;
                    closeOnlyAt = uint64(block.timestamp);
                    emit StateChanged(State.CloseOnly);
                }
            }
            vaultCash -= need;
        }
        emit Close(trader, isLong, p, pnl, payout, kind);
        _send(trader, payout);
    }

    function _removePosition(address trader, bool isLong, Position memory ps) internal {
        Side storage sd = isLong ? longSide : shortSide;
        sd.notional -= ps.notional;
        sd.size -= ps.size;
        sd.sumSnap -= (int256(ps.notional) * ps.fundSnap) / int256(WAD);
        totalMargin -= ps.margin;
        positionCount--;
        delete _pos[trader][isLong];
    }

    function withdrawProtocol() external nonReentrant {
        uint256 a = protocolAccrued;
        protocolAccrued = 0;
        _send(config.treasury(), a);
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "send");
    }
}

interface IMarketFactoryLp {
    function launchpad() external view returns (address);
}

/// @title MarketFactory
contract MarketFactory {
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

    function create(address token, address pool, address creator, uint256 gradTarget, uint8 maxLeverage) external returns (address) {
        require(msg.sender == launchpad, "launchpad");
        return address(new PerpMarket(config, pool, token, creator, gradTarget, maxLeverage));
    }
}