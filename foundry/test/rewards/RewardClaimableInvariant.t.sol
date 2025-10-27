// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { RewardClaimableTester } from "../../../contracts/testing/RewardClaimableTester.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";

contract TransferRevertingERC20 is TestMintableERC20 {
    address public blockedReceiver;

    error TransferBlocked(address receiver);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) TestMintableERC20(name_, symbol_, decimals_) {}

    function setBlockedReceiver(address receiver) external onlyOwner {
        blockedReceiver = receiver;
    }

    function _update(address from, address to, uint256 value) internal override(ERC20) {
        if (blockedReceiver != address(0) && to == blockedReceiver) {
            revert TransferBlocked(to);
        }
        super._update(from, to, value);
    }
}

contract RewardClaimableInvariant is Test {
    enum ActionType {
        None,
        Compound,
        CompoundMalicious,
        SetTreasury,
        SetFee,
        SetThreshold,
        GrantRole,
        RevokeRole,
        AdjustEmission,
        AttemptReenter
    }

    struct ActionLog {
        ActionType action;
        bool success;
        address actor;
        address receiver;
        address target;
        uint256 amount;
        uint256 value;
        address[5] tokens;
        uint8 tokenCount;
        bytes32 info;
    }

    uint256 private constant MAX_REWARD_COMBO = 4;
    uint256 private constant MAX_THRESHOLD = 1e24;
    uint256 private constant MAX_AMOUNT_MULTIPLIER = 50;
    uint256 private constant MAX_EMISSION = 5e24;

    RewardClaimableTester internal tester;
    TestMintableERC20 internal exchangeAsset;
    TestMintableERC20 internal rewardTokenA;
    TestMintableERC20 internal rewardTokenB;
    TransferRevertingERC20 internal maliciousReward;

    address internal manager;
    address internal outsider;
    address internal automation;
    address internal treasury;
    address internal depositSink;

    address[] internal actorPool;
    address[] internal receiverPool;
    address[] internal safeRewardTokens;
    address[] internal invariantTokens;
    address[] internal treasuryHistory;
    mapping(address => bool) internal seenTreasury;

    mapping(address => uint256) internal cumulativeReceiverPayout;
    mapping(address => uint256) internal cumulativeTreasuryFees;
    mapping(address => uint256) internal trackedClaimed;

    ActionLog internal lastAction;

    function setUp() public {
        manager = makeAddr("manager");
        outsider = makeAddr("outsider");
        automation = makeAddr("automation");
        treasury = makeAddr("treasury");
        depositSink = makeAddr("depositSink");

        actorPool.push(manager);
        actorPool.push(outsider);
        actorPool.push(automation);
        actorPool.push(address(this));

        receiverPool.push(makeAddr("receiver1"));
        receiverPool.push(makeAddr("receiver2"));
        receiverPool.push(manager);
        receiverPool.push(outsider);
        receiverPool.push(automation);
        receiverPool.push(treasury);

        exchangeAsset = new TestMintableERC20("Mock Exchange Asset", "mASSET", 18);
        rewardTokenA = new TestMintableERC20("Reward Token A", "RWA", 18);
        rewardTokenB = new TestMintableERC20("Reward Token B", "RWB", 18);
        maliciousReward = new TransferRevertingERC20("Malicious Reward", "MRW", 18);

        tester = new RewardClaimableTester(
            address(exchangeAsset),
            treasury,
            50_000, // 5%
            10_000, // 1%
            1e18,
            depositSink
        );

        exchangeAsset.setMinter(address(this), true);
        exchangeAsset.setMinter(address(tester), true);
        rewardTokenA.setMinter(address(tester), true);
        rewardTokenB.setMinter(address(tester), true);
        maliciousReward.setMinter(address(tester), true);

        tester.grantRole(tester.REWARDS_MANAGER_ROLE(), manager);
        tester.grantRole(tester.REWARDS_MANAGER_ROLE(), automation);

        safeRewardTokens.push(address(rewardTokenA));
        safeRewardTokens.push(address(rewardTokenB));
        safeRewardTokens.push(address(exchangeAsset));

        invariantTokens.push(address(rewardTokenA));
        invariantTokens.push(address(rewardTokenB));
        invariantTokens.push(address(exchangeAsset));
        invariantTokens.push(address(maliciousReward));

        tester.configureRewardToken(address(rewardTokenA), 5e21, false);
        tester.configureRewardToken(address(rewardTokenB), 2e21, false);
        tester.configureRewardToken(address(exchangeAsset), 1e21, false);
        tester.configureRewardToken(address(maliciousReward), 1e21, false);

        address[] memory reenterTokens = new address[](1);
        reenterTokens[0] = address(rewardTokenA);
        tester.setReenterCalldata(
            abi.encodeWithSelector(
                tester.compoundRewards.selector,
                tester.exchangeThreshold(),
                reenterTokens,
                receiverPool[0]
            )
        );

        treasuryHistory.push(treasury);
        seenTreasury[treasury] = true;

        _seedLiquidity(manager);
        _seedLiquidity(automation);
        _seedLiquidity(outsider);
        _seedLiquidity(address(this));

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = this.compound.selector;
        selectors[1] = this.compoundWithMalicious.selector;
        selectors[2] = this.updateTreasury.selector;
        selectors[3] = this.updateTreasuryFee.selector;
        selectors[4] = this.updateExchangeThreshold.selector;
        selectors[5] = this.grantManagerRole.selector;
        selectors[6] = this.revokeManagerRole.selector;
        selectors[7] = this.adjustRewardEmission.selector;
        selectors[8] = this.attemptReentrancy.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function compound(
        uint256 actorSeed,
        uint256 rawAmount,
        uint256 rewardSeed,
        uint256 rewardCountSeed,
        uint256 receiverSeed
    ) public {
        address actor = actorPool[actorSeed % actorPool.length];
        address receiver = receiverPool[receiverSeed % receiverPool.length];
        address[] memory tokens = _selectRewardTokens(rewardSeed, rewardCountSeed);

        uint256 threshold = tester.exchangeThreshold();
        uint256 amount = bound(rawAmount, threshold, threshold * MAX_AMOUNT_MULTIPLIER);

        _ensureLiquidity(actor, amount);

        (address[] memory uniqueTokens, uint256 uniqueCount) = _unique(tokens);
        uint256[] memory claimedBefore = new uint256[](uniqueCount);
        uint256[] memory treasuryBefore = new uint256[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            claimedBefore[i] = tester.totalRewardsClaimed(uniqueTokens[i]);
            treasuryBefore[i] = _sumTreasuryBalances(uniqueTokens[i]);
        }

        _captureAction(ActionType.Compound, actor, receiver, address(0), amount, 0, tokens, true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.REWARDS_MANAGER_ROLE(), actor)) {
            vm.expectRevert();
            tester.compoundRewards(amount, tokens, receiver);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        bool success = true;
        bytes memory reason;
        try tester.compoundRewards(amount, tokens, receiver) {
            // noop
        } catch (bytes memory revertData) {
            success = false;
            reason = revertData;
        }
        vm.stopPrank();

        lastAction.success = success;
        lastAction.info = _truncate(reason);

        if (!success) {
            return;
        }

        for (uint256 i = 0; i < uniqueCount; i++) {
            address token = uniqueTokens[i];
            uint256 newClaimed = tester.totalRewardsClaimed(token);
            uint256 mintedDelta = newClaimed - claimedBefore[i];
            if (mintedDelta == 0) continue;

            uint256 treasuryDelta = _sumTreasuryBalances(token) - treasuryBefore[i];
            cumulativeTreasuryFees[token] += treasuryDelta;
            cumulativeReceiverPayout[token] += mintedDelta - treasuryDelta;
            trackedClaimed[token] = newClaimed;
        }
    }

    function compoundWithMalicious(uint256 actorSeed, uint256 rawAmount, uint256 receiverSeed) public {
        address actor = actorPool[actorSeed % actorPool.length];
        address receiver = receiverPool[receiverSeed % receiverPool.length];
        address[] memory tokens = new address[](1);
        tokens[0] = address(maliciousReward);

        uint256 threshold = tester.exchangeThreshold();
        uint256 amount = bound(rawAmount, threshold, threshold * MAX_AMOUNT_MULTIPLIER);

        _ensureLiquidity(actor, amount);
        _captureAction(ActionType.CompoundMalicious, actor, receiver, address(0), amount, 0, tokens, true, bytes32(0));

        maliciousReward.setBlockedReceiver(tester.treasury());

        vm.startPrank(actor);
        bool success = true;
        bytes memory reason;
        try tester.compoundRewards(amount, tokens, receiver) {
            // If this ever succeeds the invariant suite should fail immediately.
        } catch (bytes memory revertData) {
            success = false;
            reason = revertData;
        }
        vm.stopPrank();

        maliciousReward.setBlockedReceiver(address(0));

        lastAction.success = success;
        lastAction.info = _truncate(reason);
    }

    function updateTreasury(uint256 actorSeed, uint256 newTreasurySeed) public {
        address actor = actorPool[actorSeed % actorPool.length];
        address newTreasury = address(uint160(bound(newTreasurySeed, 1, type(uint160).max)));

        _captureAction(ActionType.SetTreasury, actor, address(0), newTreasury, 0, 0, new address[](0), true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.REWARDS_MANAGER_ROLE(), actor)) {
            vm.expectRevert();
            tester.setTreasury(newTreasury);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        tester.setTreasury(newTreasury);
        vm.stopPrank();

        treasury = newTreasury;
        if (!seenTreasury[newTreasury]) {
            seenTreasury[newTreasury] = true;
            treasuryHistory.push(newTreasury);
        }
    }

    function updateTreasuryFee(uint256 actorSeed, uint256 rawFee) public {
        address actor = actorPool[actorSeed % actorPool.length];
        uint256 maxFee = tester.maxTreasuryFeeBps();
        uint256 fee = bound(rawFee, 0, maxFee);

        _captureAction(ActionType.SetFee, actor, address(0), address(0), 0, fee, new address[](0), true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.REWARDS_MANAGER_ROLE(), actor)) {
            vm.expectRevert();
            tester.setTreasuryFeeBps(fee);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        tester.setTreasuryFeeBps(fee);
        vm.stopPrank();
    }

    function updateExchangeThreshold(uint256 actorSeed, uint256 rawThreshold) public {
        address actor = actorPool[actorSeed % actorPool.length];
        uint256 threshold = bound(rawThreshold, 1, MAX_THRESHOLD);

        _captureAction(ActionType.SetThreshold, actor, address(0), address(0), threshold, 0, new address[](0), true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.REWARDS_MANAGER_ROLE(), actor)) {
            vm.expectRevert();
            tester.setExchangeThreshold(threshold);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        tester.setExchangeThreshold(threshold);
        vm.stopPrank();
    }

    function grantManagerRole(uint256 actorSeed, uint256 targetSeed) public {
        address actor = actorPool[actorSeed % actorPool.length];
        address target = actorPool[targetSeed % actorPool.length];

        _captureAction(ActionType.GrantRole, actor, address(0), target, 0, 0, new address[](0), true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.DEFAULT_ADMIN_ROLE(), actor)) {
            vm.expectRevert();
            tester.grantRole(tester.REWARDS_MANAGER_ROLE(), target);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        tester.grantRole(tester.REWARDS_MANAGER_ROLE(), target);
        vm.stopPrank();
    }

    function revokeManagerRole(uint256 actorSeed, uint256 targetSeed) public {
        address actor = actorPool[actorSeed % actorPool.length];
        address target = actorPool[targetSeed % actorPool.length];

        _captureAction(ActionType.RevokeRole, actor, address(0), target, 0, 0, new address[](0), true, bytes32(0));

        vm.startPrank(actor);
        if (!tester.hasRole(tester.DEFAULT_ADMIN_ROLE(), actor)) {
            vm.expectRevert();
            tester.revokeRole(tester.REWARDS_MANAGER_ROLE(), target);
            vm.stopPrank();
            lastAction.success = false;
            lastAction.info = bytes32("UNAUTH");
            return;
        }

        tester.revokeRole(tester.REWARDS_MANAGER_ROLE(), target);
        vm.stopPrank();
    }

    function adjustRewardEmission(uint256 tokenSeed, uint256 emissionSeed) public {
        address token = safeRewardTokens[tokenSeed % safeRewardTokens.length];
        uint256 emission = bound(emissionSeed, 0, MAX_EMISSION);

        address[] memory tokens = new address[](1);
        tokens[0] = token;
        _captureAction(ActionType.AdjustEmission, address(this), address(0), token, emission, 0, tokens, true, bytes32(0));

        tester.setRewardEmission(token, emission);
    }

    function attemptReentrancy(uint256 rawAmount, uint256 receiverSeed) public {
        address receiver = receiverPool[receiverSeed % receiverPool.length];
        address actor = manager;

        address[] memory tokens = new address[](1);
        tokens[0] = safeRewardTokens[0];

        uint256 threshold = tester.exchangeThreshold();
        uint256 amount = bound(rawAmount, threshold, threshold * MAX_AMOUNT_MULTIPLIER);

        tester.setDepositBehavior(RewardClaimableTester.DepositBehavior.Reenter);
        tester.setReenterCalldata(
            abi.encodeWithSelector(
                tester.compoundRewards.selector,
                threshold,
                tokens,
                receiver
            )
        );

        (address[] memory uniqueTokens, uint256 uniqueCount) = _unique(tokens);
        uint256[] memory claimedBefore = new uint256[](uniqueCount);
        uint256[] memory treasuryBefore = new uint256[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            claimedBefore[i] = tester.totalRewardsClaimed(uniqueTokens[i]);
            treasuryBefore[i] = _sumTreasuryBalances(uniqueTokens[i]);
        }

        _ensureLiquidity(actor, amount);
        _captureAction(ActionType.AttemptReenter, actor, receiver, address(0), amount, 0, tokens, true, bytes32(0));

        vm.startPrank(actor);
        bool success = true;
        bytes memory reason;
        try tester.compoundRewards(amount, tokens, receiver) {
            // success path is expected; reentrancy is blocked internally.
        } catch (bytes memory revertData) {
            success = false;
            reason = revertData;
        }
        vm.stopPrank();

        tester.setDepositBehavior(RewardClaimableTester.DepositBehavior.Forward);

        lastAction.success = success;
        lastAction.info = _truncate(reason);

        if (!success) {
            return;
        }

        for (uint256 i = 0; i < uniqueCount; i++) {
            address token = uniqueTokens[i];
            uint256 newClaimed = tester.totalRewardsClaimed(token);
            uint256 mintedDelta = newClaimed - claimedBefore[i];
            if (mintedDelta == 0) continue;

            uint256 treasuryDelta = _sumTreasuryBalances(token) - treasuryBefore[i];
            cumulativeTreasuryFees[token] += treasuryDelta;
            cumulativeReceiverPayout[token] += mintedDelta - treasuryDelta;
            trackedClaimed[token] = newClaimed;
        }
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantTreasuryFeesBounded() public {
        for (uint256 i = 0; i < invariantTokens.length; i++) {
            address token = invariantTokens[i];
            uint256 claimed = tester.totalRewardsClaimed(token);
            uint256 fees = cumulativeTreasuryFees[token];
            _check(fees <= claimed, "treasury fees exceed claimed rewards");
        }
    }

    function invariantPayoutsSumToRewards() public {
        for (uint256 i = 0; i < safeRewardTokens.length; i++) {
            address token = safeRewardTokens[i];
            uint256 claimed = tester.totalRewardsClaimed(token);
            uint256 totalFees = cumulativeTreasuryFees[token];
            uint256 totalReceivers = cumulativeReceiverPayout[token];
            _check(totalFees + totalReceivers == claimed, "payouts mismatch rewards");
        }
    }

    function invariantExchangeAssetSettled() public {
        uint256 contractBalance = exchangeAsset.balanceOf(address(tester));
        _check(contractBalance == 0, "exchange asset stranded on tester");
        _check(
            tester.totalExchangeAssetProcessed() == tester.totalExchangeAssetForwarded(),
            "processed exchange asset not forwarded"
        );
        _check(
            exchangeAsset.balanceOf(depositSink) == tester.totalExchangeAssetForwarded(),
            "deposit sink balance mismatch"
        );
    }

    function invariantTreasuryFeeBounded() public {
        _check(tester.treasuryFeeBps() <= tester.maxTreasuryFeeBps(), "treasury fee above max");
    }

    function invariantReentrancyGuarded() public {
        _check(!tester.lastReentrancyCallSucceeded(), "reentrancy guard bypassed");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _seedLiquidity(address account) internal {
        exchangeAsset.mint(account, 5e24);
        vm.startPrank(account);
        exchangeAsset.approve(address(tester), type(uint256).max);
        vm.stopPrank();
    }

    function _ensureLiquidity(address account, uint256 required) internal {
        uint256 balance = exchangeAsset.balanceOf(account);
        if (balance < required) {
            exchangeAsset.mint(account, required * 2);
        }
        if (IERC20(address(exchangeAsset)).allowance(account, address(tester)) < required) {
            vm.startPrank(account);
            exchangeAsset.approve(address(tester), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _selectRewardTokens(uint256 seed, uint256 countSeed) internal view returns (address[] memory tokens) {
        uint256 count = bound(countSeed, 1, MAX_REWARD_COMBO);
        tokens = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            tokens[i] = safeRewardTokens[uint256(keccak256(abi.encode(seed, i))) % safeRewardTokens.length];
        }
    }

    function _unique(address[] memory tokens) internal pure returns (address[] memory uniqueTokens, uint256 uniqueCount) {
        uniqueTokens = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            bool seen;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (uniqueTokens[j] == token) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                uniqueTokens[uniqueCount] = token;
                uniqueCount++;
            }
        }
    }

    function _sumTreasuryBalances(address token) internal view returns (uint256 total) {
        for (uint256 i = 0; i < treasuryHistory.length; i++) {
            total += IERC20(token).balanceOf(treasuryHistory[i]);
        }
    }

    function _captureAction(
        ActionType action,
        address actor,
        address receiver,
        address target,
        uint256 amount,
        uint256 value,
        address[] memory tokens,
        bool success,
        bytes32 info
    ) internal {
        lastAction.action = action;
        lastAction.success = success;
        lastAction.actor = actor;
        lastAction.receiver = receiver;
        lastAction.target = target;
        lastAction.amount = amount;
        lastAction.value = value;
        lastAction.info = info;
        lastAction.tokenCount = uint8(tokens.length > 5 ? 5 : tokens.length);
        for (uint256 i = 0; i < lastAction.tokenCount; i++) {
            lastAction.tokens[i] = tokens[i];
        }
        for (uint256 i = lastAction.tokenCount; i < lastAction.tokens.length; i++) {
            lastAction.tokens[i] = address(0);
        }
    }

    function _truncate(bytes memory data) internal pure returns (bytes32 result) {
        if (data.length == 0) {
            return bytes32(0);
        }
        if (data.length <= 32) {
            assembly {
                result := mload(add(data, 32))
            }
        } else {
            result = keccak256(data);
        }
    }

    function _check(bool condition, string memory message) internal {
        if (!condition) {
            emit log_string(message);
            emit log_named_uint("action", uint256(lastAction.action));
            emit log_named_uint("success", lastAction.success ? 1 : 0);
            emit log_named_address("actor", lastAction.actor);
            emit log_named_address("receiver", lastAction.receiver);
            emit log_named_address("target", lastAction.target);
            emit log_named_uint("amount", lastAction.amount);
            emit log_named_uint("value", lastAction.value);
            emit log_named_bytes32("info", lastAction.info);
            for (uint256 i = 0; i < lastAction.tokenCount; i++) {
                emit log_named_address("token", lastAction.tokens[i]);
            }
        }
        assertTrue(condition, message);
    }
}
