// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/common/BasisPointConstants.sol";
import "contracts/common/SupportsWithdrawalFee.sol";
import "contracts/common/WithdrawalFeeMath.sol";

contract WithdrawalFeeHarness is SupportsWithdrawalFee {
    constructor(uint256 initialFeeBps) {
        _initializeWithdrawalFee(initialFeeBps);
    }

    function calculate(uint256 grossAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.calculateWithdrawalFee(grossAmount, feeBps);
    }

    function netAfterFee(uint256 grossAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.netAfterFee(grossAmount, feeBps);
    }

    function grossFromNet(uint256 netAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.grossFromNet(netAmount, feeBps);
    }

    function calc(uint256 grossAmount) external view returns (uint256) {
        return _calculateWithdrawalFee(grossAmount);
    }

    // Allow harness tests to explore high-but-reasonable fee caps without bricking the instance.
    function _maxWithdrawalFeeBps() internal pure override returns (uint256) {
        return 5 * BasisPointConstants.ONE_PERCENT_BPS; // 5%
    }
}
