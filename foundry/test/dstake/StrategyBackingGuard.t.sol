// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { StrategyBackingGuard } from "../../../contracts/vaults/dstake/libraries/StrategyBackingGuard.sol";

contract StrategyBackingGuardHarness {
    function increase(uint256 beforeValue, uint256 afterValue, uint256 required) external pure {
        StrategyBackingGuard.assertIncrease(address(0), 0, beforeValue, afterValue, required);
    }
    function withdrawal(uint256 beforeValue, uint256 afterValue, uint256 received) external pure {
        StrategyBackingGuard.assertWithdrawal(address(0), 0, beforeValue, afterValue, received);
    }
}

contract StrategyBackingGuardTest is Test {
    StrategyBackingGuardHarness private guard;
    function setUp() public {
        guard = new StrategyBackingGuardHarness();
    }

    function testFuzz_PositiveCreditRequiresPositiveBacking(uint128 amount, uint128 beforeValue) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        vm.expectRevert(
            abi.encodeWithSelector(
                StrategyBackingGuard.StrategyBackingLoss.selector,
                address(0),
                uint8(0),
                uint256(beforeValue),
                uint256(beforeValue),
                uint256(amount)
            )
        );
        guard.increase(beforeValue, beforeValue, amount);
    }

    function testFuzz_AcceptedCreditDeficitAtMostOne(uint128 amount, uint128 gain, uint64 beforeValue) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        bool expected = gain > 0 && (gain >= amount || uint256(amount) - gain <= 1);
        try guard.increase(beforeValue, uint256(beforeValue) + gain, amount) {
            assertTrue(expected);
        } catch {
            assertFalse(expected);
        }
    }

    function testFuzz_WithdrawalMustPreserveUnpaidBacking(uint128 loss, uint128 received) public {
        bool expected = loss <= received || uint256(loss) - received <= 1;
        try guard.withdrawal(loss, 0, received) {
            assertTrue(expected);
        } catch {
            assertFalse(expected);
        }
    }

    function test_MaxValueDoesNotOverflowToleranceArithmetic() public {
        guard.increase(type(uint256).max - 2, type(uint256).max, 2);
        guard.withdrawal(type(uint256).max, type(uint256).max - 2, 2);
    }

    function test_OneUnitOfLostBackingIsTheAbsoluteLimit() public {
        guard.increase(100, 199, 100);
        vm.expectRevert();
        guard.increase(100, 198, 100);
    }
}
