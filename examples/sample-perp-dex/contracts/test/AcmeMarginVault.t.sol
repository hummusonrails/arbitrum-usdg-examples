// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {AcmeMarginVault} from "../src/AcmeMarginVault.sol";
import {AcmeOracle} from "../src/AcmeOracle.sol";

// Stands in for USDG: a 6 decimal token with EIP-3009 receiveWithAuthorization
// that, like USDG, returns without moving funds when a nonce was already used.
// It also records the rewards accept call.
contract MockUsdg is ERC20 {
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    uint32 public acceptedGroup;
    address public acceptedBy;

    constructor() ERC20("Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function digest(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(from, to, value, validAfter, validBefore, nonce));
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(to == msg.sender, "CallerMustBePayee");
        require(block.timestamp > validAfter && block.timestamp < validBefore, "window");

        if (authorizationState[from][nonce]) return;

        require(ECDSA.recover(digest(from, to, value, validAfter, validBefore, nonce), signature) == from, "sig");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }

    function acceptRegisterRewardAddress(uint32 payoutGroupId) external {
        acceptedGroup = payoutGroupId;
        acceptedBy = msg.sender;
    }
}

contract AcmeMarginVaultTest is Test {
    bytes32 constant ETH = "ETH-USD";
    uint256 constant ETH_PRICE = 2_000e8;

    MockUsdg usdg;
    AcmeOracle oracle;
    AcmeMarginVault vault;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address relayer = makeAddr("relayer");
    uint256 anaKey;
    address ana;
    uint256 kofiKey;
    address kofi;
    uint256 nonceSeed;

    function setUp() public {
        (ana, anaKey) = makeAddrAndKey("ana");
        (kofi, kofiKey) = makeAddrAndKey("kofi");
        usdg = new MockUsdg();
        oracle = new AcmeOracle(owner, keeper, 120);
        vault = new AcmeMarginVault(usdg, oracle, owner);

        vm.warp(1_800_000_000);
        vm.prank(owner);
        vault.listMarket(ETH);
        setPrice(ETH_PRICE);

        usdg.mint(owner, 1_000_000e6);
        usdg.mint(ana, 100_000e6);
        usdg.mint(kofi, 100_000e6);

        vm.startPrank(owner);
        usdg.approve(address(vault), type(uint256).max);
        vault.addLiquidity(500_000e6);
        vm.stopPrank();
    }

    function setPrice(uint256 price) internal {
        bytes32[] memory markets = new bytes32[](1);
        uint256[] memory prices = new uint256[](1);

        markets[0] = ETH;
        prices[0] = price;
        vm.prank(keeper);
        oracle.setPrices(markets, prices);
    }

    function sign(uint256 key, address from, uint256 amount, bytes32 nonce) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, usdg.digest(from, address(vault), amount, 0, block.timestamp + 1 hours, nonce));

        return abi.encodePacked(r, s, v);
    }

    function deposit(address from, uint256 key, uint256 amount) internal returns (bytes32 nonce, bytes memory sig) {
        nonce = keccak256(abi.encode(nonceSeed++));
        sig = sign(key, from, amount, nonce);
        vm.prank(relayer);
        vault.depositWithAuthorization(from, amount, 0, block.timestamp + 1 hours, nonce, sig);
    }

    function open(address who, bool isLong, uint256 collateral, uint256 size) internal {
        vm.prank(who);
        vault.openPosition(ETH, isLong, collateral, size, isLong ? type(uint256).max : 0);
    }

    function close(address who) internal returns (uint256) {
        // Closing a long sells, so any price is acceptable at zero; a short the reverse.
        uint256 acceptable = vault.positionOf(who, ETH).isLong ? 0 : type(uint256).max;

        vm.prank(who);
        return vault.closePosition(ETH, acceptable);
    }

    function books() internal view returns (uint256) {
        return vault.totalFreeMargin() + vault.totalCollateral() + vault.liquidity() + vault.rewardsHeld();
    }

    // ---------------------------------------------------------------- margin

    function testSignedDepositCreditsSigner() public {
        deposit(ana, anaKey, 1_000e6);

        assertEq(vault.freeMargin(ana), 1_000e6);
        assertEq(vault.freeMargin(relayer), 0);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testReplayedAuthorizationIsRefused() public {
        (bytes32 nonce, bytes memory sig) = deposit(ana, anaKey, 1_000e6);

        vm.expectRevert(AcmeMarginVault.DepositNotReceived.selector);
        vm.prank(relayer);
        vault.depositWithAuthorization(ana, 1_000e6, 0, block.timestamp + 1 hours, nonce, sig);

        assertEq(vault.freeMargin(ana), 1_000e6);
    }

    function testWithdrawOnlyFreeMargin() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 500e6, 1_000e6);

        vm.expectRevert(AcmeMarginVault.InsufficientMargin.selector);
        vm.prank(ana);
        vault.withdraw(600e6, ana);

        vm.prank(ana);
        vault.withdraw(499e6, ana);
        assertEq(usdg.balanceOf(ana), 99_499e6);
    }

    // ------------------------------------------------------------- positions

    function testOpenLocksCollateralAndPaysFee() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 200e6, 1_000e6);

        assertEq(vault.feeOf(1_000e6), 1e6);
        assertEq(vault.freeMargin(ana), 799e6);
        assertEq(vault.lockedMargin(ana), 200e6);
        assertEq(vault.liquidity(), 500_001e6);
        assertEq(vault.reservedLiquidity(), 1_000e6);
        assertEq(vault.positionOf(ana, ETH).entryPrice, ETH_PRICE);
    }

    function testLeverageBounds() public {
        deposit(ana, anaKey, 1_000e6);

        vm.expectRevert(AcmeMarginVault.LeverageOutOfRange.selector);
        open(ana, true, 100e6, 1_001e6);

        vm.expectRevert(AcmeMarginVault.LeverageOutOfRange.selector);
        open(ana, true, 100e6, 99e6);
    }

    function testOnePositionPerMarket() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 100e6, 500e6);

        vm.expectRevert(AcmeMarginVault.PositionExists.selector);
        open(ana, false, 100e6, 500e6);
    }

    function testAcceptablePriceGuards() public {
        deposit(ana, anaKey, 1_000e6);

        vm.expectRevert(AcmeMarginVault.PriceSlippage.selector);
        vm.prank(ana);
        vault.openPosition(ETH, true, 100e6, 500e6, ETH_PRICE - 1);

        vm.expectRevert(AcmeMarginVault.PriceSlippage.selector);
        vm.prank(ana);
        vault.openPosition(ETH, false, 100e6, 500e6, ETH_PRICE + 1);
    }

    function testLongProfitAndShortLoss() public {
        deposit(ana, anaKey, 1_000e6);
        deposit(kofi, kofiKey, 1_000e6);
        open(ana, true, 200e6, 1_000e6);
        open(kofi, false, 200e6, 1_000e6);
        setPrice(2_100e8);

        // +5% on 1,000: +50 profit for the long, -50 for the short, less the 1 USDG close fee.
        assertEq(vault.pnlOf(ana, ETH), 50e6);
        assertEq(vault.pnlOf(kofi, ETH), -50e6);
        assertEq(close(ana), 249e6);
        assertEq(close(kofi), 149e6);
        assertEq(vault.freeMargin(ana), 799e6 + 249e6);
        assertEq(vault.freeMargin(kofi), 799e6 + 149e6);
        // The house took two open fees and two close fees; the PnL netted out.
        assertEq(vault.liquidity(), 500_004e6);
        assertEq(vault.reservedLiquidity(), 0);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testLossRoundsAgainstTrader() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 300e6, 1_000e6);
        // A tiny move whose loss is not a whole number of base units.
        setPrice(ETH_PRICE - 1);

        assertEq(vault.pnlOf(ana, ETH), -1);
    }

    function testProfitCappedAtSize() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 100e6, 1_000e6);
        setPrice(ETH_PRICE * 3);

        assertEq(vault.pnlOf(ana, ETH), 1_000e6);
        assertEq(close(ana), 100e6 + 1_000e6 - 1e6);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testOpenNeedsUnreservedLiquidity() public {
        vm.prank(owner);
        vault.removeLiquidity(499_000e6, owner);
        deposit(ana, anaKey, 1_000e6);

        vm.expectRevert(AcmeMarginVault.InsufficientLiquidity.selector);
        open(ana, true, 200e6, 1_001e6);

        open(ana, true, 100e6, 900e6);

        vm.expectRevert(AcmeMarginVault.InsufficientLiquidity.selector);
        vm.prank(owner);
        vault.removeLiquidity(200e6, owner);
    }

    function testLiquidationOnlyUnderMaintenance() public {
        deposit(ana, anaKey, 1_000e6);
        // 10x long: 100 collateral, 1,000 size. Close fee 1, maintenance 10.
        open(ana, true, 100e6, 1_000e6);

        // At -8.9% equity is 100 - 89 - 1 = 10, right at maintenance.
        setPrice(1_822e8);
        assertTrue(vault.isLiquidatable(ana, ETH));

        setPrice(1_823e8);
        assertFalse(vault.isLiquidatable(ana, ETH));

        vm.expectRevert(AcmeMarginVault.NotLiquidatable.selector);
        vault.liquidate(ana, ETH);

        setPrice(1_800e8);
        uint256 liquidityBefore = vault.liquidity();

        vm.prank(keeper);
        vault.liquidate(ana, ETH);

        assertEq(vault.lockedMargin(ana), 0);
        assertEq(vault.positionOf(ana, ETH).size, 0);
        assertEq(vault.liquidity(), liquidityBefore + 100e6);
        assertEq(vault.reservedLiquidity(), 0);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testStalePriceStopsTrading() public {
        deposit(ana, anaKey, 1_000e6);
        vm.warp(block.timestamp + 121);

        vm.expectRevert(AcmeOracle.StalePrice.selector);
        open(ana, true, 100e6, 500e6);
    }

    function testOnlyKeeperPushesPrices() public {
        bytes32[] memory markets = new bytes32[](1);
        uint256[] memory prices = new uint256[](1);

        markets[0] = ETH;
        prices[0] = 1;

        vm.expectRevert(AcmeOracle.NotKeeper.selector);
        oracle.setPrices(markets, prices);
    }

    // --------------------------------------------------------------- rewards

    function testRewardsSplitBetweenHouseAndTraders() public {
        // Ana holds 199,900 USDG of margin after the open fee, 50,000 of it
        // posted as collateral; Kofi holds 100,000; the house 500,100.
        usdg.mint(ana, 100_000e6);
        deposit(ana, anaKey, 200_000e6);
        deposit(kofi, kofiKey, 100_000e6);
        open(ana, true, 50_000e6, 100_000e6);

        uint256 house = vault.liquidity();
        uint256 traders = vault.totalFreeMargin() + vault.totalCollateral();

        usdg.mint(address(this), 800e6);
        usdg.approve(address(vault), 800e6);
        vault.notifyRewards(800e6);

        uint256 toHouse = (800e6 * house) / (house + traders);

        assertEq(vault.liquidity(), house + toHouse);
        assertApproxEqAbs(vault.pendingRewards(ana) + vault.pendingRewards(kofi), 800e6 - toHouse, 2);
        // Ana's posted collateral counts, so she earns on all of her margin.
        assertApproxEqAbs(vault.pendingRewards(ana), ((800e6 - toHouse) * 199_900) / 299_900, 1);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testLaterDepositDoesNotShareEarlierRewards() public {
        deposit(ana, anaKey, 10_000e6);
        notify(1_000e6);

        uint256 anaBefore = vault.pendingRewards(ana);

        deposit(kofi, kofiKey, 10_000e6);

        assertEq(vault.pendingRewards(kofi), 0);
        assertEq(vault.pendingRewards(ana), anaBefore);
    }

    function testRewardsSurviveLiquidation() public {
        deposit(ana, anaKey, 1_000e6);
        open(ana, true, 900e6, 9_000e6);
        notify(1_000e6);

        uint256 earnedBefore = vault.pendingRewards(ana);

        assertGt(earnedBefore, 0);
        setPrice(1_000e8);
        vault.liquidate(ana, ETH);

        assertEq(vault.pendingRewards(ana), earnedBefore);
    }

    function testClaimCreditsMargin() public {
        deposit(ana, anaKey, 10_000e6);
        notify(1_000e6);

        uint256 pending = vault.pendingRewards(ana);

        vm.prank(ana);
        assertEq(vault.claimRewards(), pending);
        assertEq(vault.freeMargin(ana), 10_000e6 + pending);
        assertEq(vault.pendingRewards(ana), 0);
        assertEq(usdg.balanceOf(address(vault)), books());
    }

    function testRewardsWithNoTradersGoToHouse() public {
        uint256 house = vault.liquidity();

        notify(100e6);

        assertEq(vault.liquidity(), house + 100e6);
        assertEq(vault.rewardsHeld(), 0);
    }

    function testAcceptIsOwnerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ana));
        vm.prank(ana);
        vault.acceptRewardsRegistration(7);

        vm.prank(owner);
        vault.acceptRewardsRegistration(7);

        assertEq(usdg.acceptedGroup(), 7);
        assertEq(usdg.acceptedBy(), address(vault));
    }

    function notify(uint256 amount) internal {
        usdg.mint(address(this), amount);
        usdg.approve(address(vault), amount);
        vault.notifyRewards(amount);
    }

    // ----------------------------------------------------------------- books

    /// Random deposits, trades, price moves, liquidations, rewards, claims, and
    /// withdrawals never leave the vault short of what it owes, never let the
    /// house fall below what it reserved, and never owe traders more rewards
    /// than it holds for them.
    function testFuzzBooksAlwaysBalance(uint256[24] memory ops) public {
        address[2] memory traders = [ana, kofi];
        uint256[2] memory keys = [anaKey, kofiKey];

        for (uint256 i; i < ops.length; i++) {
            uint256 op = ops[i] % 7;
            uint256 t = (ops[i] >> 8) % 2;
            address who = traders[t];
            uint256 amount = bound(ops[i] >> 16, 1e6, 20_000e6);

            if (op == 0 && usdg.balanceOf(who) >= amount) {
                deposit(who, keys[t], amount);
            } else if (op == 1 && vault.positionOf(who, ETH).size == 0) {
                uint256 collateral = amount / 4;
                uint256 size = collateral * bound(ops[i] >> 80, 1, 10);

                if (vault.freeMargin(who) >= collateral + vault.feeOf(size) && collateral > 0) {
                    open(who, (ops[i] >> 90) % 2 == 0, collateral, size);
                }
            } else if (op == 2) {
                setPrice(bound(ops[i] >> 100, 1_000e8, 3_000e8));
            } else if (op == 3 && vault.positionOf(who, ETH).size != 0) {
                if (vault.isLiquidatable(who, ETH)) vault.liquidate(who, ETH);
                else close(who);
            } else if (op == 4) {
                notify(amount / 100);
            } else if (op == 5) {
                vm.prank(who);
                vault.claimRewards();
            } else if (op == 6 && vault.freeMargin(who) > 0) {
                uint256 free = vault.freeMargin(who);

                vm.prank(who);
                vault.withdraw(free, who);
            }

            assertEq(usdg.balanceOf(address(vault)), books());
            assertGe(vault.liquidity(), vault.reservedLiquidity());
            assertLe(vault.pendingRewards(ana) + vault.pendingRewards(kofi), vault.rewardsHeld());
        }
    }
}
