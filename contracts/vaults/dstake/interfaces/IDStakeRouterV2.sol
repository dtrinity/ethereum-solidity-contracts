// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IDStakeCollateralVaultV2 } from "./IDStakeCollateralVaultV2.sol";

interface IDStakeRouterV2 {
    // --- Views ---
    function paused() external view returns (bool);

    function collateralVault() external view returns (IDStakeCollateralVaultV2);

    function dStakeToken() external view returns (address);

    function totalManagedAssets() external view returns (uint256);

    function currentShortfall() external view returns (uint256);

    function withdrawalFeeBps() external view returns (uint256);

    function maxWithdrawalFeeBps() external pure returns (uint256);

    function maxDeposit(address receiver) external view returns (uint256);

    function maxMint(address receiver) external view returns (uint256);

    function maxWithdraw(address owner) external view returns (uint256);

    function maxRedeem(address owner) external view returns (uint256);

    function getActiveVaultsForDeposits() external view returns (address[] memory activeVaults);

    function getMaxSingleVaultWithdraw() external view returns (uint256 maxAssets);

    function strategyShareToAdapter(address strategyShare) external view returns (address);

    // --- Token Hooks ---
    function handleDeposit(address initiator, uint256 assets, uint256 shares, address receiver) external;

    function handleWithdraw(
        address initiator,
        address receiver,
        address owner,
        uint256 grossAssets,
        uint256 expectedNetAssets
    ) external returns (uint256 netAssets, uint256 fee);

    // --- Solver Flows ---
    function solverDepositAssets(
        address[] calldata vaults,
        uint256[] calldata assets,
        uint256 minShares,
        address receiver
    ) external returns (uint256 sharesMinted);

    function solverDepositShares(
        address[] calldata vaults,
        uint256[] calldata strategyShares,
        uint256 minShares,
        address receiver
    ) external returns (uint256 sharesMinted);

    function solverWithdrawAssets(
        address[] calldata vaults,
        uint256[] calldata assets,
        uint256 maxShares,
        address receiver,
        address owner
    ) external returns (uint256 netAssets, uint256 fee, uint256 sharesBurned);

    function solverWithdrawShares(
        address[] calldata vaults,
        uint256[] calldata strategyShares,
        uint256 maxShares,
        address receiver,
        address owner
    ) external returns (uint256 netAssets, uint256 fee, uint256 sharesBurned);

    // --- Maintenance ---
    function reinvestFees() external returns (uint256 amountReinvested, uint256 incentivePaid);

    function setReinvestIncentive(uint256 newIncentiveBps) external;

    function setWithdrawalFee(uint256 newFeeBps) external;

    function recordShortfall(uint256 delta) external;

    function clearShortfall(uint256 amount) external;
}
