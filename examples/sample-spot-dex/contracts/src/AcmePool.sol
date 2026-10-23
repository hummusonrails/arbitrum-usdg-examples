// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IUSDGRewards} from "./IUSDGRewards.sol";

/// @title AcmePool
/// @notice A constant product pool quoted in USDG, whose LP token shares any
/// USDG rewards the pool's operator routes to it. Because the pool holds its
/// own reserves, it can register for USDG rewards itself: the operator
/// proposes it, then calls `acceptRewardsRegistration`.
/// @dev Example code for learning the integration. It is unaudited and not
/// meant to hold real funds.
contract AcmePool is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    // Scales rewards per LP token so small rewards on a large LP supply keep
    // their precision.
    uint256 private constant PRECISION = 1e30;

    IERC20 public immutable base;
    IERC20 public immutable quote;

    // Reserves live in storage, so rewards and direct transfers never move the price.
    uint256 private baseReserve;
    uint256 private quoteReserve;

    uint256 public rewardPerShare;
    uint256 private notified;
    uint256 private paidOut;
    mapping(address => uint256) private rewardDebt;
    mapping(address => uint256) private earned;

    event Swap(
        address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to
    );
    event LiquidityAdded(address indexed to, uint256 baseUsed, uint256 quoteUsed, uint256 liquidity);
    event LiquidityRemoved(
        address indexed from, address indexed to, uint256 baseOut, uint256 quoteOut, uint256 liquidity
    );
    event RewardsNotified(address indexed from, uint256 amount, uint256 rewardPerShare);
    event RewardsClaimed(address indexed account, address indexed to, uint256 amount);
    event RewardsRegistrationAccepted(uint32 indexed payoutGroupId);

    error InsufficientOutput();
    error InsufficientLiquidity();
    error InvalidToken();
    error NoLiquidity();
    error ZeroAmount();

    constructor(IERC20 base_, IERC20 quote_, string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        base = base_;
        quote = quote_;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (baseReserve, quoteReserve);
    }

    /// @notice What `amountIn` of `tokenIn` buys now, after the 0.30% fee.
    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint256 rIn, uint256 rOut) = _reservesFor(tokenIn);
        uint256 withFee = amountIn * 997;

        return (withFee * rOut) / (rIn * 1000 + withFee);
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();

        amountOut = getAmountOut(tokenIn, amountIn);

        if (amountOut < minAmountOut || amountOut == 0) revert InsufficientOutput();

        bool baseIn = tokenIn == address(base);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        (baseIn ? quote : base).safeTransfer(to, amountOut);

        if (baseIn) {
            baseReserve += amountIn;
            quoteReserve -= amountOut;
        } else {
            quoteReserve += amountIn;
            baseReserve -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    /// @notice Adds liquidity at the current price, using as much of the
    /// desired amounts as the ratio allows. The first deposit sets the price.
    function addLiquidity(uint256 baseDesired, uint256 quoteDesired, uint256 minLiquidity, address to)
        external
        nonReentrant
        returns (uint256 baseUsed, uint256 quoteUsed, uint256 liquidity)
    {
        uint256 supply = totalSupply();

        if (supply == 0) {
            (baseUsed, quoteUsed) = (baseDesired, quoteDesired);
            liquidity = Math.sqrt(baseUsed * quoteUsed);

            if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

            liquidity -= MINIMUM_LIQUIDITY;
            // Locks a sliver of liquidity forever so the pool can never be drained to zero.
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            baseUsed = baseDesired;
            quoteUsed = (baseDesired * quoteReserve) / baseReserve;

            if (quoteUsed > quoteDesired) {
                quoteUsed = quoteDesired;
                baseUsed = (quoteDesired * baseReserve) / quoteReserve;
            }

            liquidity = Math.min((baseUsed * supply) / baseReserve, (quoteUsed * supply) / quoteReserve);
        }

        if (liquidity == 0 || liquidity < minLiquidity) revert InsufficientLiquidity();

        base.safeTransferFrom(msg.sender, address(this), baseUsed);
        quote.safeTransferFrom(msg.sender, address(this), quoteUsed);
        baseReserve += baseUsed;
        quoteReserve += quoteUsed;
        _mint(to, liquidity);

        emit LiquidityAdded(to, baseUsed, quoteUsed, liquidity);
    }

    function removeLiquidity(uint256 liquidity, uint256 minBase, uint256 minQuote, address to)
        external
        nonReentrant
        returns (uint256 baseOut, uint256 quoteOut)
    {
        uint256 supply = totalSupply();

        baseOut = (baseReserve * liquidity) / supply;
        quoteOut = (quoteReserve * liquidity) / supply;

        // Burning LP for nothing back is never what the caller meant.
        if (baseOut == 0 || quoteOut == 0) revert InsufficientLiquidity();
        if (baseOut < minBase || quoteOut < minQuote) revert InsufficientOutput();

        _burn(msg.sender, liquidity);
        baseReserve -= baseOut;
        quoteReserve -= quoteOut;
        base.safeTransfer(to, baseOut);
        quote.safeTransfer(to, quoteOut);

        emit LiquidityRemoved(msg.sender, to, baseOut, quoteOut, liquidity);
    }

    /// @notice Shares `amount` USDG across current LP holders by LP balance.
    /// Anyone may fund it; the operator calls it after claiming the pool's
    /// USDG rewards.
    function notifyRewards(uint256 amount) external nonReentrant {
        uint256 supply = totalSupply();

        // With only the locked liquidity left, every reward would go to the
        // dead address, where nobody can claim it.
        if (supply <= MINIMUM_LIQUIDITY) revert NoLiquidity();
        if (amount == 0) revert ZeroAmount();

        quote.safeTransferFrom(msg.sender, address(this), amount);
        rewardPerShare += (amount * PRECISION) / supply;
        notified += amount;

        emit RewardsNotified(msg.sender, amount, rewardPerShare);
    }

    function pendingRewards(address account) public view returns (uint256) {
        return earned[account] + _accrued(account);
    }

    function claimRewards(address to) external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = earned[msg.sender];

        if (amount == 0) return 0;

        earned[msg.sender] = 0;
        paidOut += amount;
        quote.safeTransfer(to, amount);

        emit RewardsClaimed(msg.sender, to, amount);
    }

    /// @notice USDG routed to LPs and not yet claimed. It includes rounding
    /// dust and the locked liquidity's share, which nobody can claim.
    function rewardsHeld() external view returns (uint256) {
        return notified - paidOut;
    }

    /// @notice Completes registration for USDG rewards. USDG accepts only
    /// from the proposed address itself, so the pool must make this call.
    function acceptRewardsRegistration(uint32 payoutGroupId) external onlyOwner {
        IUSDGRewards(address(quote)).acceptRegisterRewardAddress(payoutGroupId);

        emit RewardsRegistrationAccepted(payoutGroupId);
    }

    function _reservesFor(address tokenIn) private view returns (uint256, uint256) {
        if (tokenIn == address(base)) return (baseReserve, quoteReserve);
        if (tokenIn == address(quote)) return (quoteReserve, baseReserve);

        revert InvalidToken();
    }

    function _accrued(address account) private view returns (uint256) {
        return (balanceOf(account) * (rewardPerShare - rewardDebt[account])) / PRECISION;
    }

    function _settle(address account) private {
        earned[account] += _accrued(account);
        rewardDebt[account] = rewardPerShare;
    }

    // Settles both sides before any balance changes, so rewards earned until
    // now stay with whoever held the LP tokens while they were earned.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);

        super._update(from, to, value);
    }
}
