// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockFraxEtherRouter
 * @notice Minimal mock exposing the EtherRouter consolidated balance view for testing.
 */
contract MockFraxEtherRouter {
    struct CachedConsEFxBalances {
        uint96 ethFree;
        uint96 ethInLpBalanced;
        uint96 ethTotalBalanced;
        uint96 frxEthFree;
        uint96 frxEthInLpBalanced;
        uint96 frxEthTotalBalanced;
    }

    CachedConsEFxBalances private balances;
    bool public shouldRevert;

    function setEthTotalBalanced(uint256 amount) external {
        balances.ethTotalBalanced = uint96(amount);
    }

    function setBalances(CachedConsEFxBalances calldata newBalances) external {
        balances = newBalances;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function getConsolidatedEthFrxEthBalanceView(bool) external view returns (CachedConsEFxBalances memory) {
        if (shouldRevert) revert("MockFraxEtherRouter: revert requested");
        return balances;
    }
}
