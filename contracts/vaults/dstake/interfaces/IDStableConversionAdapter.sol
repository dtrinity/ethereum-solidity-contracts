// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStableConversionAdapter Interface
 * @notice Interface for contracts that handle the conversion between the core stable asset (dUSD/dETH)
 *         and a specific yield-bearing or convertible ERC20 token (`vault asset`), as well as
 *         valuing that `vault asset` in terms of the stable asset.
 * @dev Implementations interact with specific protocols (lending pools, DEX LPs, wrappers, etc.).
 */
interface IDStableConversionAdapter {
    /**
     * @notice Converts a specified amount of the stable asset into the specific `vaultAsset`
     *         managed by this adapter.
     * @dev The adapter MUST pull `stableAmount` of the stable asset from the caller (expected to be the Router).
     * @dev The resulting `vaultAsset` MUST be sent/deposited/minted directly to the `collateralVault` address provided during adapter setup or retrieved.
     * @param stableAmount The amount of stable asset to convert.
     * @return vaultAsset The address of the specific `vault asset` token managed by this adapter.
     * @return vaultAssetAmount The amount of `vaultAsset` generated from the conversion.
     */
    function convertToVaultAsset(uint256 stableAmount) external returns (address vaultAsset, uint256 vaultAssetAmount);

    /**
     * @notice Converts a specific amount of `vaultAsset` back into the stable asset.
     * @dev The adapter MUST pull the required amount of `vaultAsset` from the caller (expected to be the Router).
     * @dev The resulting stable asset MUST be sent to the caller.
     * @param vaultAssetAmount The amount of `vaultAsset` to convert.
     * @return stableAmount The amount of stable asset sent to the caller.
     */
    function convertFromVaultAsset(uint256 vaultAssetAmount) external returns (uint256 stableAmount);

    /**
     * @notice Preview the result of converting a given stable amount to vaultAsset (without state change).
     * @param stableAmount The amount of stable asset to preview conversion for.
     * @return vaultAsset The address of the specific `vault asset` token managed by this adapter.
     * @return vaultAssetAmount The amount of `vaultAsset` that would be received.
     */
    function previewConvertToVaultAsset(
        uint256 stableAmount
    ) external view returns (address vaultAsset, uint256 vaultAssetAmount);

    /**
     * @notice Preview the result of converting a given vaultAsset amount to stable asset (without state change).
     * @param vaultAssetAmount The amount of `vaultAsset` to preview conversion for.
     * @return stableAmount The amount of stable asset that would be received.
     */
    function previewConvertFromVaultAsset(uint256 vaultAssetAmount) external view returns (uint256 stableAmount);

    /**
     * @notice Calculates the value of a given amount of the specific `vaultAsset` managed by this adapter
     *         in terms of the stable asset.
     * @param vaultAsset The address of the vault asset token (should match getVaultAsset()). Included for explicitness.
     * @param vaultAssetAmount The amount of the `vaultAsset` to value.
     * @return stableValue The equivalent value in the stable asset.
     */
    function assetValueInDStable(
        address vaultAsset,
        uint256 vaultAssetAmount
    ) external view returns (uint256 stableValue);

    /**
     * @notice Returns the address of the specific `vault asset` token managed by this adapter.
     * @return The address of the `vault asset`.
     */
    function vaultAsset() external view returns (address);
}
