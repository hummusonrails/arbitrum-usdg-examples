// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AcmePool} from "../src/AcmePool.sol";

contract MockToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory symbol, uint8 decimals_) ERC20(symbol, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Stands in for USDG: a 6 decimal token that records the accept call.
contract MockUsdg is MockToken {
    uint32 public acceptedGroup;
    address public acceptedBy;

    constructor() MockToken("USDG", 6) {}

    function acceptRegisterRewardAddress(uint32 payoutGroupId) external {
        acceptedGroup = payoutGroupId;
        acceptedBy = msg.sender;
    }
}

contract AcmePoolTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockToken weth;
    MockUsdg usdg;
    AcmePool pool;

    address owner = makeAddr("owner");
    address lena = makeAddr("lena");
    address omar = makeAddr("omar");
    address trader = makeAddr("trader");

    function setUp() public {
        weth = new MockToken("WETH", 18);
        usdg = new MockUsdg();
        pool = new AcmePool(weth, usdg, "Acme LP WETH/USDG", "ALP-WETH", owner);

        for (uint256 i; i < 4; i++) {
            address who = [owner, lena, omar, trader][i];

            weth.mint(who, 1_000 ether);
            usdg.mint(who, 10_000_000e6);
            vm.startPrank(who);
            weth.approve(address(pool), type(uint256).max);
            usdg.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _seed(address who, uint256 base, uint256 quote) internal returns (uint256 liquidity) {
        vm.prank(who);
        (,, liquidity) = pool.addLiquidity(base, quote, 0, who);
    }

    function _formula(uint256 amountIn, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        uint256 withFee = amountIn * 997;

        return (withFee * rOut) / (rIn * 1000 + withFee);
    }

    function testFirstMintLocksMinimum() public {
        uint256 liquidity = _seed(lena, 10 ether, 24_000e6);

        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(liquidity, Math.sqrt(10 ether * 24_000e6) - 1000);
        assertEq(pool.balanceOf(lena), liquidity);
    }

    function testSwapMatchesFormula() public {
        _seed(lena, 10 ether, 24_000e6);

        uint256 expected = _formula(1_000e6, 24_000e6, 10 ether);

        assertEq(pool.getAmountOut(address(usdg), 1_000e6), expected);

        uint256 before = weth.balanceOf(trader);

        vm.prank(trader);
        uint256 out = pool.swapExactIn(address(usdg), 1_000e6, expected, trader);

        assertEq(out, expected);
        assertEq(weth.balanceOf(trader) - before, expected);

        (uint256 rb, uint256 rq) = pool.getReserves();

        assertEq(rb, 10 ether - expected);
        assertEq(rq, 25_000e6);

        uint256 back = _formula(0.1 ether, rb, rq);

        vm.prank(trader);
        assertEq(pool.swapExactIn(address(weth), 0.1 ether, 0, trader), back);
    }

    function testSwapRespectsMinOut() public {
        _seed(lena, 10 ether, 24_000e6);

        uint256 expected = pool.getAmountOut(address(usdg), 1_000e6);

        vm.prank(trader);
        vm.expectRevert(AcmePool.InsufficientOutput.selector);
        pool.swapExactIn(address(usdg), 1_000e6, expected + 1, trader);
    }

    function testSwapRejectsOtherTokens() public {
        _seed(lena, 10 ether, 24_000e6);

        vm.prank(trader);
        vm.expectRevert(AcmePool.InvalidToken.selector);
        pool.swapExactIn(address(pool), 1, 0, trader);
    }

    function testRemoveReturnsProRata() public {
        _seed(lena, 10 ether, 24_000e6);

        uint256 omarLp = _seed(omar, 5 ether, 12_000e6);
        uint256 supply = pool.totalSupply();
        (uint256 rb, uint256 rq) = pool.getReserves();

        vm.prank(omar);
        (uint256 b, uint256 q) = pool.removeLiquidity(omarLp, 0, 0, omar);

        assertEq(b, (rb * omarLp) / supply);
        assertEq(q, (rq * omarLp) / supply);
        assertEq(pool.balanceOf(omar), 0);
    }

    function testAddUsesCurrentRatio() public {
        _seed(lena, 10 ether, 24_000e6);

        vm.prank(omar);
        (uint256 baseUsed, uint256 quoteUsed,) = pool.addLiquidity(1 ether, 100_000e6, 0, omar);

        assertEq(baseUsed, 1 ether);
        assertEq(quoteUsed, 2_400e6);
    }

    function testRewardsSplitByLpBalance() public {
        uint256 lenaLp = _seed(lena, 30 ether, 72_000e6);

        vm.prank(lena);
        pool.transfer(omar, lenaLp / 4);

        vm.prank(owner);
        pool.notifyRewards(400e6);

        // The dead address holds a tiny share, so each LP is a unit or two short.
        assertApproxEqAbs(pool.pendingRewards(lena), 300e6, 2);
        assertApproxEqAbs(pool.pendingRewards(omar), 100e6, 2);
        assertEq(pool.rewardsHeld(), 400e6);
    }

    function testRewardsSurviveTransferAndBurn() public {
        uint256 lenaLp = _seed(lena, 10 ether, 24_000e6);

        vm.prank(owner);
        pool.notifyRewards(100e6);

        uint256 earned = pool.pendingRewards(lena);

        vm.prank(lena);
        pool.transfer(omar, lenaLp / 2);

        assertEq(pool.pendingRewards(lena), earned);
        assertEq(pool.pendingRewards(omar), 0);

        vm.prank(lena);
        pool.removeLiquidity(lenaLp / 2, 0, 0, lena);

        assertEq(pool.pendingRewards(lena), earned);

        vm.prank(owner);
        pool.notifyRewards(50e6);

        assertEq(pool.pendingRewards(lena), earned);
        assertApproxEqAbs(pool.pendingRewards(omar), 50e6, 1);

        uint256 before = usdg.balanceOf(lena);

        vm.prank(lena);
        assertEq(pool.claimRewards(lena), earned);
        assertEq(usdg.balanceOf(lena) - before, earned);
        assertEq(pool.pendingRewards(lena), 0);
    }

    function testDirectTransferIgnored() public {
        _seed(lena, 10 ether, 24_000e6);

        uint256 quoted = pool.getAmountOut(address(usdg), 1_000e6);

        vm.prank(trader);
        usdg.transfer(address(pool), 5_000e6);

        (uint256 rb, uint256 rq) = pool.getReserves();

        assertEq(rb, 10 ether);
        assertEq(rq, 24_000e6);
        assertEq(pool.getAmountOut(address(usdg), 1_000e6), quoted);
    }

    function testNotifyRefusesZeroAndEmptyPool() public {
        vm.prank(owner);
        vm.expectRevert(AcmePool.NoLiquidity.selector);
        pool.notifyRewards(1e6);

        _seed(lena, 10 ether, 24_000e6);

        vm.prank(owner);
        vm.expectRevert(AcmePool.ZeroAmount.selector);
        pool.notifyRewards(0);
    }

    function testHeldCoversOwed(uint256[6] memory amounts, uint8 claimMask) public {
        _seed(lena, 10 ether, 24_000e6);
        _seed(omar, 3 ether, 7_200e6);

        for (uint256 i; i < amounts.length; i++) {
            vm.prank(owner);
            pool.notifyRewards(bound(amounts[i], 1, 1_000_000e6));

            if (claimMask & (1 << i) != 0) {
                vm.prank(i % 2 == 0 ? lena : omar);
                pool.claimRewards(i % 2 == 0 ? lena : omar);
            }

            if (i == 2) {
                uint256 third = pool.balanceOf(lena) / 3;

                vm.prank(lena);
                pool.transfer(trader, third);
            }
        }

        (, uint256 rq) = pool.getReserves();
        uint256 owed = pool.pendingRewards(lena) + pool.pendingRewards(omar) + pool.pendingRewards(trader)
            + pool.pendingRewards(DEAD);

        assertGe(usdg.balanceOf(address(pool)), rq + pool.rewardsHeld());
        assertLe(owed, pool.rewardsHeld());
    }

    function testAcceptIsOwnerOnly() public {
        vm.prank(lena);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, lena));
        pool.acceptRewardsRegistration(6);

        vm.prank(owner);
        pool.acceptRewardsRegistration(6);

        assertEq(usdg.acceptedGroup(), 6);
        assertEq(usdg.acceptedBy(), address(pool));
    }

    function testRemoveRefusesZeroOut() public {
        _seed(lena, 10 ether, 24_000e6);

        vm.prank(lena);
        vm.expectRevert(AcmePool.InsufficientLiquidity.selector);
        pool.removeLiquidity(1, 0, 0, lena);
    }

    function testNotifyRefusesWhenOnlyLockedLiquidityRemains() public {
        uint256 lenaLp = _seed(lena, 10 ether, 24_000e6);

        vm.prank(lena);
        pool.removeLiquidity(lenaLp, 0, 0, lena);

        vm.prank(owner);
        vm.expectRevert(AcmePool.NoLiquidity.selector);
        pool.notifyRewards(1e6);
    }
}
