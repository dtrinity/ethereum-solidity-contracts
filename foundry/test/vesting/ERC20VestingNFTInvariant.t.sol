// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { ERC20VestingNFT } from "../../../contracts/vaults/vesting/ERC20VestingNFT.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";

contract ERC20VestingNFTInvariant is Test {
    uint256 private constant VESTING_PERIOD = 26 weeks;
    uint256 private constant INITIAL_MAX_SUPPLY = 1_000_000 ether;
    uint256 private constant INITIAL_MIN_DEPOSIT = 100 ether;
    uint256 private constant MAX_DEPOSIT_ATTEMPT = 2_000_000 ether;
    uint256 private constant MAX_TIME_WARP = 365 days;

    ERC20VestingNFT internal vesting;
    TestMintableERC20 internal asset;
    address internal owner;
    address[] internal actors;

    struct ExpectedPosition {
        bool exists;
        address owner;
        uint256 amount;
        uint256 depositTime;
        bool matured;
        uint256 minRequirement;
    }

    mapping(uint256 => ExpectedPosition) internal expectedPositions;
    uint256[] internal trackedTokenIds;
    mapping(address => bool) internal hasApproved;

    function setUp() public {
        owner = makeAddr("vestingOwner");
        asset = new TestMintableERC20("Mock dSTAKE", "mdSTAKE", 18);

        vesting = new ERC20VestingNFT(
            "Mock dSTAKE Vest",
            "mdVEST",
            address(asset),
            VESTING_PERIOD,
            INITIAL_MAX_SUPPLY,
            INITIAL_MIN_DEPOSIT,
            owner
        );

        actors.push(makeAddr("alice"));
        actors.push(makeAddr("bob"));
        actors.push(makeAddr("carol"));
        actors.push(makeAddr("dave"));
        actors.push(makeAddr("erin"));

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = this.actionDeposit.selector;
        selectors[1] = this.actionRedeem.selector;
        selectors[2] = this.actionWithdraw.selector;
        selectors[3] = this.actionToggleDeposits.selector;
        selectors[4] = this.actionAdjustMaxSupply.selector;
        selectors[5] = this.actionAdjustMinDeposit.selector;
        selectors[6] = this.actionTransferAttempt.selector;
        selectors[7] = this.actionWarpTime.selector;
        targetSelector(
            FuzzSelector({
                addr: address(this),
                selectors: selectors
            })
        );
    }

    // -------------------------------------------------------------------------
    // Fuzz Actions
    // -------------------------------------------------------------------------

    function actionDeposit(uint256 actorSeed, uint256 amountSeed) public {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(amountSeed, 0, MAX_DEPOSIT_ATTEMPT);

        _primeAllowance(actor, amount);

        uint256 minRequirement = vesting.minDepositAmount();
        uint256 totalDeposited = vesting.totalDeposited();
        uint256 maxSupply = vesting.maxTotalSupply();
        bool depositsEnabled = vesting.depositsEnabled();

        vm.startPrank(actor);

        if (amount == 0) {
            vm.expectRevert(ERC20VestingNFT.ZeroAmount.selector);
            vesting.deposit(amount);
            vm.stopPrank();
            return;
        }

        if (!depositsEnabled) {
            vm.expectRevert(ERC20VestingNFT.DepositsDisabled.selector);
            vesting.deposit(amount);
            vm.stopPrank();
            return;
        }

        if (amount < minRequirement) {
            vm.expectRevert(ERC20VestingNFT.DepositBelowMinimum.selector);
            vesting.deposit(amount);
            vm.stopPrank();
            return;
        }

        if (totalDeposited + amount > maxSupply) {
            vm.expectRevert(ERC20VestingNFT.MaxSupplyExceeded.selector);
            vesting.deposit(amount);
            vm.stopPrank();
            return;
        }

        uint256 tokenId = vesting.deposit(amount);
        vm.stopPrank();

        trackedTokenIds.push(tokenId);

        expectedPositions[tokenId] = ExpectedPosition({
            exists: true,
            owner: actor,
            amount: amount,
            depositTime: block.timestamp,
            matured: false,
            minRequirement: minRequirement
        });
    }

    function actionRedeem(uint256 actorSeed, uint256 tokenSeed) public {
        address actor = actors[actorSeed % actors.length];
        uint256 tokenId = _selectToken(tokenSeed);
        ExpectedPosition storage expected = expectedPositions[tokenId];

        vm.startPrank(actor);

        if (!expected.exists) {
            vm.expectRevert(ERC20VestingNFT.TokenNotExists.selector);
            vesting.redeemEarly(tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.owner != actor) {
            vm.expectRevert(ERC20VestingNFT.NotTokenOwner.selector);
            vesting.redeemEarly(tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.matured) {
            vm.expectRevert(ERC20VestingNFT.TokenAlreadyMatured.selector);
            vesting.redeemEarly(tokenId);
            vm.stopPrank();
            return;
        }

        if (block.timestamp >= expected.depositTime + VESTING_PERIOD) {
            vm.expectRevert(ERC20VestingNFT.VestingAlreadyComplete.selector);
            vesting.redeemEarly(tokenId);
            vm.stopPrank();
            return;
        }

        vesting.redeemEarly(tokenId);
        vm.stopPrank();

        expected.exists = false;
        expected.owner = address(0);
        expected.amount = 0;
        expected.depositTime = 0;
        expected.matured = false;
        expected.minRequirement = 0;
    }

    function actionWithdraw(uint256 actorSeed, uint256 tokenSeed, uint256 warpSeed) public {
        address actor = actors[actorSeed % actors.length];
        uint256 tokenId = _selectToken(tokenSeed);
        ExpectedPosition storage expected = expectedPositions[tokenId];

        if (warpSeed % 2 == 0) {
            uint256 delta = bound(warpSeed, 1, MAX_TIME_WARP);
            vm.warp(block.timestamp + delta);
        }

        vm.startPrank(actor);

        if (!expected.exists) {
            vm.expectRevert(ERC20VestingNFT.TokenNotExists.selector);
            vesting.withdrawMatured(tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.owner != actor) {
            vm.expectRevert(ERC20VestingNFT.NotTokenOwner.selector);
            vesting.withdrawMatured(tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.matured) {
            vm.expectRevert(ERC20VestingNFT.TokenAlreadyMatured.selector);
            vesting.withdrawMatured(tokenId);
            vm.stopPrank();
            return;
        }

        if (block.timestamp < expected.depositTime + VESTING_PERIOD) {
            vm.expectRevert(ERC20VestingNFT.VestingNotComplete.selector);
            vesting.withdrawMatured(tokenId);
            vm.stopPrank();
            return;
        }

        vesting.withdrawMatured(tokenId);
        vm.stopPrank();

        expected.matured = true;
    }

    function actionToggleDeposits(uint256 flagSeed) public {
        bool enabled = flagSeed % 2 == 0;

        vm.prank(owner);
        vesting.setDepositsEnabled(enabled);
    }

    function actionAdjustMaxSupply(uint256 newCapSeed) public {
        uint256 total = vesting.totalDeposited();
        uint256 newCap = bound(newCapSeed, 0, MAX_DEPOSIT_ATTEMPT);

        if (total > 0 && newCapSeed % 2 == 0) {
            uint256 delta = (newCapSeed % total) + 1;
            newCap = total - delta;
        }

        vm.prank(owner);
        vesting.setMaxTotalSupply(newCap);
    }

    function actionAdjustMinDeposit(uint256 newMinSeed) public {
        uint256 newMin = bound(newMinSeed, 0, MAX_DEPOSIT_ATTEMPT);

        vm.prank(owner);
        vesting.setMinDepositAmount(newMin);
    }

    function actionTransferAttempt(uint256 actorSeed, uint256 tokenSeed, uint256 receiverSeed) public {
        address actor = actors[actorSeed % actors.length];
        address receiver = actors[receiverSeed % actors.length];
        uint256 tokenId = _selectToken(tokenSeed);
        ExpectedPosition storage expected = expectedPositions[tokenId];

        vm.startPrank(actor);

        if (!expected.exists) {
            vm.expectRevert(ERC20VestingNFT.TokenNotExists.selector);
            vesting.safeTransferFrom(actor, receiver, tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.owner != actor) {
            vm.expectRevert(ERC20VestingNFT.NotTokenOwner.selector);
            vesting.safeTransferFrom(actor, receiver, tokenId);
            vm.stopPrank();
            return;
        }

        if (expected.matured) {
            vm.expectRevert(ERC20VestingNFT.TransferOfMaturedToken.selector);
            vesting.safeTransferFrom(actor, receiver, tokenId);
            vm.stopPrank();
            return;
        }

        vesting.safeTransferFrom(actor, receiver, tokenId);
        vm.stopPrank();

        expected.owner = receiver;
    }

    function actionWarpTime(uint256 warpSeed) public {
        uint256 delta = bound(warpSeed, 1, MAX_TIME_WARP);
        vm.warp(block.timestamp + delta);
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariant_totalDepositedMatchesActivePositions() public view {
        uint256 expectedTotal;
        for (uint256 i = 0; i < trackedTokenIds.length; i++) {
            uint256 tokenId = trackedTokenIds[i];
            ExpectedPosition memory expected = expectedPositions[tokenId];
            if (expected.exists && !expected.matured) {
                expectedTotal += expected.amount;
            }
        }

        assertEq(vesting.totalDeposited(), expectedTotal, "totalDeposited mismatch");
    }

    function invariant_positionsRespectMinimums() public view {
        for (uint256 i = 0; i < trackedTokenIds.length; i++) {
            uint256 tokenId = trackedTokenIds[i];
            ExpectedPosition memory expected = expectedPositions[tokenId];
            if (expected.exists && !expected.matured) {
                assertGe(expected.amount, expected.minRequirement, "deposit below recorded minimum");
            }
        }
    }

    function invariant_redeemedAndWithdrawnClearState() public view {
        for (uint256 i = 0; i < trackedTokenIds.length; i++) {
            uint256 tokenId = trackedTokenIds[i];
            ExpectedPosition memory expected = expectedPositions[tokenId];
            (uint256 amount, uint256 depositTime, bool matured, ) = vesting.getVestingPosition(tokenId);

            if (!expected.exists) {
                assertEq(amount, 0, "amount should be zero");
                assertEq(depositTime, 0, "deposit time should be zero");
                assertEq(matured, false, "matured flag should be false");
            } else if (expected.matured) {
                assertEq(matured, true, "matured flag not set");
                assertEq(amount, expected.amount, "matured amount mismatch");
            } else {
                assertEq(amount, expected.amount, "active amount mismatch");
                assertEq(depositTime, expected.depositTime, "deposit time mismatch");
                assertTrue(!matured, "active position marked matured");
            }
        }
    }

    function invariant_maturedTokensRemainWithOwner() public view {
        for (uint256 i = 0; i < trackedTokenIds.length; i++) {
            uint256 tokenId = trackedTokenIds[i];
            ExpectedPosition memory expected = expectedPositions[tokenId];
            if (expected.exists && expected.matured) {
                assertEq(vesting.ownerOf(tokenId), expected.owner, "matured token owner changed");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _primeAllowance(address actor, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        uint256 balance = asset.balanceOf(actor);
        if (balance < amount) {
            asset.mint(actor, amount - balance);
        }

        if (!hasApproved[actor]) {
            vm.startPrank(actor);
            asset.approve(address(vesting), type(uint256).max);
            vm.stopPrank();
            hasApproved[actor] = true;
        }
    }

    function _selectToken(uint256 tokenSeed) internal view returns (uint256) {
        if (trackedTokenIds.length == 0) {
            return 0;
        }
        return trackedTokenIds[tokenSeed % trackedTokenIds.length];
    }
}
