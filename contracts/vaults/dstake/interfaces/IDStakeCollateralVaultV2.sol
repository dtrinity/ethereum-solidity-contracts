// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStakeCollateralVaultV2 Interface
 * @notice Defines the external functions of the DStakeCollateralVaultV2 required by other
 *         contracts in the dSTAKE system, primarily the DStakeTokenV2.
 */
interface IDStakeCollateralVaultV2 {
    /**
     * @notice Calculates the total value of all managed `strategy shares` held by the vault,
     *         denominated in the underlying dStable asset.
     * @dev This is typically called by the DStakeTokenV2's `totalAssets()` function.
     * @return dStableValue The total value of managed assets in terms of the dStable asset.
     */
    function totalValueInDStable() external view returns (uint256 dStableValue);

    /**
     * @notice Returns the address of the underlying dStable asset the vault operates with.
     * @return The address of the dStable asset.
     */
    function dStable() external view returns (address);

    /**
     * @notice The DStakeTokenV2 contract address this vault serves.
     */
    function dStakeToken() external view returns (address);

    /**
     * @notice The DStakeRouter contract address allowed to interact.
     */
    function router() external view returns (address);

    /**
     * @notice Returns the strategy share at `index` from the internal supported list.
     */
    function supportedStrategyShares(uint256 index) external view returns (address);

    /**
     * @notice Returns the entire list of supported strategy shares. Convenient for UIs & off-chain analytics.
     */
    function getSupportedStrategyShares() external view returns (address[] memory);

    /**
     * @notice Transfers `amount` of `strategyShare` from this vault to the `recipient`.
     * @dev Only callable by the registered router.
     * @param strategyShare The address of the strategy share to send.
     * @param amount The amount to send.
     * @param recipient The address to receive the shares.
     */
    function transferStrategyShares(address strategyShare, uint256 amount, address recipient) external;

    /**
     * @notice Sets the address of the DStakeRouter contract.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param _newRouter The address of the new router contract.
     */
    function setRouter(address _newRouter) external;

    /**
     * @notice Adds a strategy share to the supported list. Callable only by the router.
     */
    function addSupportedStrategyShare(address strategyShare) external;

    /**
     * @notice Removes a strategy share from the supported list. Callable only by the router.
     */
    function removeSupportedStrategyShare(address strategyShare) external;

    /**
     * @notice Emitted when the router address is set.
     * @param router The address of the new router.
     */
    event RouterSet(address indexed router);

    /**
     * @notice Emitted when a new strategy share is added to the supported list.
     */
    event StrategyShareSupported(address indexed strategyShare);

    /**
     * @notice Emitted when a strategy share is removed from the supported list.
     */
    event StrategyShareRemoved(address indexed strategyShare);
}
