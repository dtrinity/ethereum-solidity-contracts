// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "contracts/common/IAaveOracle.sol";
import "contracts/common/IMintableERC20.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";

/**
 * @title IssuerV2_1
 * @notice Issuer responsible for minting dStable tokens with asset-level controls and collateral backing checks
 */
contract IssuerV2_1 is AccessControl, OracleAware, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20Metadata;

    /* Core state */

    IMintableERC20 public dstable;
    uint8 public immutable dstableDecimals;
    CollateralVault public collateralVault;

    /* Events */

    event CollateralVaultSet(address indexed collateralVault);
    event AssetMintingPauseUpdated(address indexed asset, bool paused);

    /* Roles */

    bytes32 public constant INCENTIVES_MANAGER_ROLE = keccak256("INCENTIVES_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /* Errors */

    error SlippageTooHigh(uint256 minDStable, uint256 dstableAmount);
    error IssuanceSurpassesCollateral(uint256 collateralInDstable, uint256 totalDstable);
    error AssetMintingPaused(address asset);

    /* Overrides */

    // If true, minting with this collateral asset is paused at the issuer level
    mapping(address => bool) public assetMintingPaused;

    /**
     * @notice Initializes the IssuerV2_1 contract with core dependencies
     * @param _collateralVault The address of the collateral vault
     * @param _dstable The address of the dStable stablecoin
     * @param oracle The address of the price oracle
     */
    constructor(address _collateralVault, address _dstable, IPriceOracleGetter oracle)
        OracleAware(oracle, oracle.BASE_CURRENCY_UNIT())
    {
        collateralVault = CollateralVault(_collateralVault);
        dstable = IMintableERC20(_dstable);
        dstableDecimals = dstable.decimals();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(INCENTIVES_MANAGER_ROLE, msg.sender);
        grantRole(PAUSER_ROLE, msg.sender);
    }

    /* Issuer */

    /**
     * @notice Issues dStable tokens in exchange for collateral from the caller
     * @param collateralAmount The amount of collateral to deposit
     * @param collateralAsset The address of the collateral asset being deposited
     * @param minDStable The minimum amount of dStable the caller expects (slippage guard)
     */
    function issue(uint256 collateralAmount, address collateralAsset, uint256 minDStable)
        external
        whenNotPaused
        nonReentrant
    {
        if (!isAssetMintingEnabled(collateralAsset)) {
            revert AssetMintingPaused(collateralAsset);
        }

        uint8 collateralDecimals = IERC20Metadata(collateralAsset).decimals();
        uint256 baseValue = Math.mulDiv(
            oracle.getAssetPrice(collateralAsset),
            collateralAmount,
            10 ** collateralDecimals
        );
        uint256 dstableAmount = baseValueToDstableAmount(baseValue);
        if (dstableAmount < minDStable) {
            revert SlippageTooHigh(minDStable, dstableAmount);
        }

        // Transfer collateral directly to vault
        IERC20Metadata(collateralAsset).safeTransferFrom(msg.sender, address(collateralVault), collateralAmount);

        // Ensure post-mint total supply remains backed by collateral value
        uint256 postSupply = dstable.totalSupply() + dstableAmount;
        uint256 collateralCover = collateralInDstable();
        if (collateralCover < postSupply) {
            revert IssuanceSurpassesCollateral(collateralCover, postSupply);
        }

        dstable.mint(msg.sender, dstableAmount);
    }

    /**
     * @notice Issues dStable tokens using excess collateral in the system
     * @param receiver The address to receive the minted dStable tokens
     * @param dstableAmount The amount of dStable to mint
     */
    function issueUsingExcessCollateral(address receiver, uint256 dstableAmount)
        external
        onlyRole(INCENTIVES_MANAGER_ROLE)
        whenNotPaused
    {
        dstable.mint(receiver, dstableAmount);

        uint256 totalSupply = dstable.totalSupply();
        uint256 collateralCover = collateralInDstable();
        if (collateralCover < totalSupply) {
            revert IssuanceSurpassesCollateral(collateralCover, totalSupply);
        }
    }

    /**
     * @notice Calculates the collateral value in dStable tokens
     * @return The amount of dStable tokens equivalent to the collateral value
     */
    function collateralInDstable() public view returns (uint256) {
        uint256 collateralInBase = collateralVault.totalValue();
        return baseValueToDstableAmount(collateralInBase);
    }

    /**
     * @notice Converts a base value to an equivalent amount of dStable tokens
     * @param baseValue The amount of base value to convert
     * @return The equivalent amount of dStable tokens
     */
    function baseValueToDstableAmount(uint256 baseValue) public view returns (uint256) {
        return Math.mulDiv(baseValue, 10 ** dstableDecimals, baseCurrencyUnit);
    }

    /**
     * @notice Returns whether `asset` is currently enabled for minting by the issuer
     * @dev Asset must be supported by the collateral vault and not paused by issuer
     */
    function isAssetMintingEnabled(address asset) public view returns (bool) {
        if (!collateralVault.isCollateralSupported(asset)) {
            return false;
        }
        return !assetMintingPaused[asset];
    }

    /* Admin */

    /**
     * @notice Sets the collateral vault address
     * @param _collateralVault The address of the collateral vault
     */
    function setCollateralVault(address _collateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collateralVault = CollateralVault(_collateralVault);
        emit CollateralVaultSet(_collateralVault);
    }

    /**
     * @notice Set minting pause override for a specific collateral asset
     * @param asset The collateral asset address
     * @param paused True to pause minting; false to enable
     */
    function setAssetMintingPause(address asset, bool paused) external onlyRole(PAUSER_ROLE) {
        if (!collateralVault.isCollateralSupported(asset)) {
            revert CollateralVault.UnsupportedCollateral(asset);
        }
        assetMintingPaused[asset] = paused;
        emit AssetMintingPauseUpdated(asset, paused);
    }

    /**
     * @notice Pause all minting operations
     */
    function pauseMinting() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause all minting operations
     */
    function unpauseMinting() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
