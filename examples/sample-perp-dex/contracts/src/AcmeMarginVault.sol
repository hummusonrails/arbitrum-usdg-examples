// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AcmeOracle} from "./AcmeOracle.sol";
import {IUSDG} from "./IUSDG.sol";

/// @title AcmeMarginVault
/// @notice Holds every USDG of a small perp exchange: traders' margin, the
/// collateral behind their positions, and the house liquidity that takes the
/// other side. Positions are bookkeeping, so collateral never leaves the
/// vault. Because the vault holds all of it, the vault can register for USDG
/// rewards itself: the operator proposes it, then calls
/// `acceptRewardsRegistration`.
/// @dev Example code for learning the integration. It is unaudited and not
/// meant to hold real funds. The engine is deliberately small: isolated
/// positions at an oracle price, one per trader per market, no funding or
/// borrow fees, and liquidations that send the remaining collateral to the
/// house.
contract AcmeMarginVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // 0.10% of the position size, charged on open and on close.
    uint256 public constant FEE_BPS = 10;
    // A position is liquidatable once its equity falls to 1% of its size.
    uint256 public constant MAINTENANCE_BPS = 100;
    uint256 public constant MAX_LEVERAGE = 10;
    uint256 private constant BPS = 10_000;
    // Scales rewards per unit of margin so small rewards keep their precision.
    uint256 private constant PRECISION = 1e30;

    struct Position {
        bool isLong;
        // In USD with USDG's 6 decimals, valuing one USDG at one dollar.
        uint256 size;
        uint256 collateral;
        // In USD with the oracle's 8 decimals.
        uint256 entryPrice;
    }

    IERC20 public immutable usdg;
    AcmeOracle public immutable oracle;

    mapping(bytes32 => bool) public isListed;
    mapping(address => mapping(bytes32 => Position)) private positions;

    // Margin a trader can withdraw or post, and margin posted as collateral.
    mapping(address => uint256) public freeMargin;
    mapping(address => uint256) public lockedMargin;
    uint256 public totalFreeMargin;
    uint256 public totalCollateral;

    // The house: it takes fees and losses, pays profits, and reserves each open
    // position's largest possible profit so it can always pay.
    uint256 public liquidity;
    uint256 public reservedLiquidity;

    uint256 public rewardPerUnit;
    uint256 private routedToTraders;
    uint256 private creditedToMargin;
    mapping(address => uint256) private rewardDebt;
    mapping(address => uint256) private earned;

    event MarketListed(bytes32 indexed market);
    event MarginDeposited(address indexed trader, address indexed relayer, uint256 amount, bytes32 nonce);
    event MarginWithdrawn(address indexed trader, address indexed to, uint256 amount);
    event PositionOpened(
        address indexed trader,
        bytes32 indexed market,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 price,
        uint256 fee
    );
    event PositionClosed(
        address indexed trader, bytes32 indexed market, uint256 price, int256 pnl, uint256 fee, uint256 payout
    );
    event PositionLiquidated(
        address indexed trader,
        bytes32 indexed market,
        address indexed liquidator,
        uint256 price,
        int256 pnl,
        uint256 collateral
    );
    event LiquidityAdded(address indexed from, uint256 amount);
    event LiquidityRemoved(address indexed to, uint256 amount);
    event RewardsNotified(address indexed from, uint256 amount, uint256 toTraders, uint256 toLiquidity);
    event RewardsCredited(address indexed trader, uint256 amount);
    event RewardsRegistrationAccepted(uint32 indexed payoutGroupId);

    error ZeroAmount();
    error UnknownMarket();
    error PositionExists();
    error NoPosition();
    error LeverageOutOfRange();
    error PriceSlippage();
    error InsufficientMargin();
    error InsufficientLiquidity();
    error NotLiquidatable();
    error DepositNotReceived();
    error NothingToShare();

    constructor(IERC20 usdg_, AcmeOracle oracle_, address owner_) Ownable(owner_) {
        usdg = usdg_;
        oracle = oracle_;
    }

    function listMarket(bytes32 market) external onlyOwner {
        isListed[market] = true;

        emit MarketListed(market);
    }

    // ---------------------------------------------------------------- margin

    /// @notice Deposits margin with the trader's EIP-3009 signature, so the
    /// trader signs once and anyone, such as Acme's relayer, submits it. The
    /// margin is always credited to the signer.
    function depositWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 before = usdg.balanceOf(address(this));

        IUSDG(address(usdg)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, signature
        );

        // USDG returns without moving funds when the nonce was already used, so
        // only a balance that rose by the full amount counts as a deposit.
        if (usdg.balanceOf(address(this)) - before != amount) revert DepositNotReceived();

        _settle(from);
        freeMargin[from] += amount;
        totalFreeMargin += amount;

        emit MarginDeposited(from, msg.sender, amount, nonce);
    }

    function withdraw(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (freeMargin[msg.sender] < amount) revert InsufficientMargin();

        _settle(msg.sender);
        freeMargin[msg.sender] -= amount;
        totalFreeMargin -= amount;
        usdg.safeTransfer(to, amount);

        emit MarginWithdrawn(msg.sender, to, amount);
    }

    // ------------------------------------------------------------- positions

    /// @notice Opens a position of `size` backed by `collateral` from free
    /// margin, plus the open fee. A long reverts above `acceptablePrice` and a
    /// short below it.
    function openPosition(bytes32 market, bool isLong, uint256 collateral, uint256 size, uint256 acceptablePrice)
        external
        nonReentrant
    {
        if (!isListed[market]) revert UnknownMarket();
        if (positions[msg.sender][market].size != 0) revert PositionExists();
        if (collateral == 0) revert ZeroAmount();
        if (size < collateral || size > collateral * MAX_LEVERAGE) revert LeverageOutOfRange();

        uint256 price = oracle.priceOf(market);

        if (isLong ? price > acceptablePrice : price < acceptablePrice) revert PriceSlippage();

        uint256 fee = feeOf(size);

        if (freeMargin[msg.sender] < collateral + fee) revert InsufficientMargin();
        if (liquidity - reservedLiquidity < size) revert InsufficientLiquidity();

        _settle(msg.sender);
        freeMargin[msg.sender] -= collateral + fee;
        totalFreeMargin -= collateral + fee;
        lockedMargin[msg.sender] += collateral;
        totalCollateral += collateral;
        liquidity += fee;
        reservedLiquidity += size;
        positions[msg.sender][market] = Position(isLong, size, collateral, price);

        emit PositionOpened(msg.sender, market, isLong, size, collateral, price, fee);
    }

    /// @notice Closes the whole position at the oracle price. The collateral
    /// plus profit, or minus loss, less the close fee returns to free margin.
    /// A long reverts below `acceptablePrice` and a short above it.
    function closePosition(bytes32 market, uint256 acceptablePrice) external nonReentrant returns (uint256 payout) {
        Position memory p = positions[msg.sender][market];

        if (p.size == 0) revert NoPosition();

        uint256 price = oracle.priceOf(market);

        if (p.isLong ? price < acceptablePrice : price > acceptablePrice) revert PriceSlippage();

        int256 pnl = _pnl(p, price);
        uint256 fee = feeOf(p.size);
        int256 equity = int256(p.collateral) + pnl - int256(fee);

        payout = equity > 0 ? uint256(equity) : 0;

        _settle(msg.sender);
        _release(msg.sender, market, p);
        // Profit is capped at the size the house reserved, so this never
        // takes the house below zero.
        liquidity = liquidity + p.collateral - payout;
        freeMargin[msg.sender] += payout;
        totalFreeMargin += payout;

        emit PositionClosed(msg.sender, market, price, pnl, fee, payout);
    }

    /// @notice Anyone may liquidate a position whose equity has fallen to the
    /// maintenance margin. Its collateral goes to the house.
    function liquidate(address trader, bytes32 market) external nonReentrant {
        Position memory p = positions[trader][market];

        if (p.size == 0) revert NoPosition();

        uint256 price = oracle.priceOf(market);
        int256 pnl = _pnl(p, price);

        if (!_underMaintenance(p, pnl)) revert NotLiquidatable();

        _settle(trader);
        _release(trader, market, p);
        liquidity += p.collateral;

        emit PositionLiquidated(trader, market, msg.sender, price, pnl, p.collateral);
    }

    function positionOf(address trader, bytes32 market) external view returns (Position memory) {
        return positions[trader][market];
    }

    /// @notice Profit or loss at the current oracle price, before the close fee.
    function pnlOf(address trader, bytes32 market) external view returns (int256) {
        Position memory p = positions[trader][market];

        if (p.size == 0) revert NoPosition();

        return _pnl(p, oracle.priceOf(market));
    }

    function isLiquidatable(address trader, bytes32 market) external view returns (bool) {
        Position memory p = positions[trader][market];

        return p.size != 0 && _underMaintenance(p, _pnl(p, oracle.priceOf(market)));
    }

    function feeOf(uint256 size) public pure returns (uint256) {
        return Math.mulDiv(size, FEE_BPS, BPS, Math.Rounding.Ceil);
    }

    // ----------------------------------------------------------------- house

    function addLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        usdg.safeTransferFrom(msg.sender, address(this), amount);
        liquidity += amount;

        emit LiquidityAdded(msg.sender, amount);
    }

    /// @notice Removes house liquidity that no open position has reserved.
    function removeLiquidity(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (liquidity - reservedLiquidity < amount) revert InsufficientLiquidity();

        liquidity -= amount;
        usdg.safeTransfer(to, amount);

        emit LiquidityRemoved(to, amount);
    }

    // --------------------------------------------------------------- rewards

    /// @notice Shares `amount` USDG across everyone whose USDG sits in the
    /// vault, by balance now: the house liquidity's share joins the liquidity,
    /// and the traders' share is spread per unit of margin (free margin plus
    /// position collateral). Anyone may fund it; the operator calls it after
    /// claiming the vault's USDG rewards.
    function notifyRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 traderMargin = totalFreeMargin + totalCollateral;

        if (traderMargin + liquidity == 0) revert NothingToShare();

        usdg.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toLiquidity = Math.mulDiv(amount, liquidity, traderMargin + liquidity);
        uint256 toTraders = amount - toLiquidity;

        liquidity += toLiquidity;

        if (toTraders > 0) {
            rewardPerUnit += Math.mulDiv(toTraders, PRECISION, traderMargin);
            routedToTraders += toTraders;
        }

        emit RewardsNotified(msg.sender, amount, toTraders, toLiquidity);
    }

    function pendingRewards(address trader) public view returns (uint256) {
        return earned[trader] + _accrued(trader);
    }

    /// @notice Adds the caller's rewards to their free margin. They stay in
    /// the vault, ready to trade with or withdraw.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = earned[msg.sender];

        if (amount == 0) return 0;

        earned[msg.sender] = 0;
        creditedToMargin += amount;
        freeMargin[msg.sender] += amount;
        totalFreeMargin += amount;

        emit RewardsCredited(msg.sender, amount);
    }

    /// @notice USDG routed to traders and not yet added to their margin. It
    /// includes rounding dust that nobody can claim.
    function rewardsHeld() external view returns (uint256) {
        return routedToTraders - creditedToMargin;
    }

    /// @notice Completes registration for USDG rewards. USDG accepts only
    /// from the proposed address itself, so the vault must make this call.
    function acceptRewardsRegistration(uint32 payoutGroupId) external onlyOwner {
        IUSDG(address(usdg)).acceptRegisterRewardAddress(payoutGroupId);

        emit RewardsRegistrationAccepted(payoutGroupId);
    }

    // -------------------------------------------------------------- internal

    // Profit rounds down and loss rounds up, so rounding always favors the
    // house. Profit is capped at the position size, which the house reserved.
    function _pnl(Position memory p, uint256 price) private pure returns (int256) {
        bool up = price >= p.entryPrice;
        uint256 move = up ? price - p.entryPrice : p.entryPrice - price;

        if (up == p.isLong) {
            return int256(Math.min(Math.mulDiv(p.size, move, p.entryPrice), p.size));
        }

        return -int256(Math.mulDiv(p.size, move, p.entryPrice, Math.Rounding.Ceil));
    }

    function _underMaintenance(Position memory p, int256 pnl) private pure returns (bool) {
        int256 equity = int256(p.collateral) + pnl - int256(feeOf(p.size));

        return equity <= int256((p.size * MAINTENANCE_BPS) / BPS);
    }

    function _release(address trader, bytes32 market, Position memory p) private {
        delete positions[trader][market];
        lockedMargin[trader] -= p.collateral;
        totalCollateral -= p.collateral;
        reservedLiquidity -= p.size;
    }

    function _accrued(address trader) private view returns (uint256) {
        uint256 margin = freeMargin[trader] + lockedMargin[trader];

        return (margin * (rewardPerUnit - rewardDebt[trader])) / PRECISION;
    }

    // Runs before any change to a trader's margin, so rewards routed until now
    // are counted on the margin the trader held while they were routed.
    function _settle(address trader) private {
        earned[trader] += _accrued(trader);
        rewardDebt[trader] = rewardPerUnit;
    }
}
