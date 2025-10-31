// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStakeRouterV2Module
 * @notice Metadata surface every DStake router delegatecall module must expose so the router can validate wiring.
 */
interface IDStakeRouterV2Module {
    /**
     * @notice Returns module wiring metadata used to validate compatibility during router configuration.
     * @return storageFingerprint Unique identifier for the expected storage layout version.
     * @return dStakeTokenAddress Immutable dSTAKE token address baked into the module.
     * @return collateralVaultAddress Immutable collateral vault address baked into the module.
     */
    function moduleMetadata()
        external
        view
        returns (bytes32 storageFingerprint, address dStakeTokenAddress, address collateralVaultAddress);
}
