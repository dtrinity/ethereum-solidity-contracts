// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStableConversionAdapterV2 Interface
 * @notice Interface for contracts that handle the conversion between the core stable asset (dUSD/dETH)
 *         and a specific yield-bearing or convertible ERC20 token (`strategy share`), as well as
 *         valuing that `strategy share` in terms of the stable asset.
 * @dev Implementations interact with specific protocols (lending pools, DEX LPs, wrappers, etc.).
 * @dev SECURITY: adapters must mint strategy shares straight to the collateral vault, burn (or transfer out) those
 *      shares before calling upstream withdraws, and rely on preview/rate helpers so wrapper supply cannot diverge from
 *      the underlying balance. See `WrappedDLendInvariant.test.ts` for the regression harness new adapters should copy.
 */
interface IDStableConversionAdapterV2 {
    /**
     * @notice Converts a specified amount of the stable asset into the specific `strategyShare`
     *         managed by this adapter.
     * @dev The adapter MUST pull `stableAmount` of the stable asset from the caller (expected to be the Router).
     * @dev The resulting `strategyShare` MUST be sent/deposited/minted directly to the `collateralVault` address provided during adapter setup or retrieved.
     * @param stableAmount The amount of stable asset to convert.
     * @return strategyShare The address of the specific `strategy share` token managed by this adapter.
     * @return strategyShareAmount The amount of `strategyShare` generated from the conversion.
     */
    function depositIntoStrategy(
        uint256 stableAmount
    ) external returns (address strategyShare, uint256 strategyShareAmount);

    /**
     * @notice Converts a specific amount of `strategyShare` back into the stable asset.
     * @dev The adapter MUST pull the required amount of `strategyShare` from the caller (expected to be the Router).
     * @dev The resulting stable asset MUST be sent to the caller.
     * @param strategyShareAmount The amount of `strategyShare` to convert.
     * @return stableAmount The amount of stable asset sent to the caller.
     */
    function withdrawFromStrategy(uint256 strategyShareAmount) external returns (uint256 stableAmount);

    /**
     * @notice Preview the result of converting a given stable amount to strategyShare (without state change).
     * @param stableAmount The amount of stable asset to preview conversion for.
     * @return strategyShare The address of the specific `strategy share` token managed by this adapter.
     * @return strategyShareAmount The amount of `strategyShare` that would be received.
     */
    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view returns (address strategyShare, uint256 strategyShareAmount);

    /**
     * @notice Preview the result of converting a given strategyShare amount to stable asset (without state change).
     * @param strategyShareAmount The amount of `strategyShare` to preview conversion for.
     * @return stableAmount The amount of stable asset that would be received.
     */
    function previewWithdrawFromStrategy(uint256 strategyShareAmount) external view returns (uint256 stableAmount);

    /**
     * @notice Calculates the value of a given amount of the specific `strategyShare` managed by this adapter
     *         in terms of the stable asset.
     * @param strategyShare The address of the strategy share token (should match strategyShare()). Included for explicitness.
     * @param strategyShareAmount The amount of the `strategyShare` to value.
     * @return stableValue The equivalent value in the stable asset.
     */
    function strategyShareValueInDStable(
        address strategyShare,
        uint256 strategyShareAmount
    ) external view returns (uint256 stableValue);

    /**
     * @notice Returns the address of the specific `strategy share` token managed by this adapter.
     * @return The address of the `strategy share`.
     */
    function strategyShare() external view returns (address);
}
