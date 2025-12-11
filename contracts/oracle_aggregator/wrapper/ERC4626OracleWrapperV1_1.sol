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

import "../interface/IOracleWrapperV1_1.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title ERC4626OracleWrapperV1_1
 * @notice Oracle wrapper for ERC4626 vaults where the underlying asset is pegged 1:1 with the base currency.
 * @dev Returns the vault's exchange rate as the price. Useful for assets like sfrxETH where frxETH ≈ 1 ETH.
 *
 *      Price calculation: convertToAssets(1 share) scaled to BASE_CURRENCY_UNIT
 *
 *      This wrapper is simpler than ChainlinkERC4626WrapperV1_1 because it doesn't require
 *      a separate price feed for the underlying asset - it assumes the underlying is 1:1 with base.
 */
contract ERC4626OracleWrapperV1_1 is IOracleWrapperV1_1, AccessControl {
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;

    struct VaultConfig {
        IERC4626 vault;
        uint8 shareDecimals;
        uint8 assetDecimals;
    }

    mapping(address => VaultConfig) public assetToVault;

    /* Events */

    event VaultSet(address indexed asset, address indexed vault, uint8 shareDecimals, uint8 assetDecimals);
    event VaultRemoved(address indexed asset);

    /* Errors */

    error VaultNotSet(address asset);
    error VaultAddressZero();
    error VaultNotContract(address vault);
    error AssetDoesNotMatchVault(address asset, address vault);
    error UnsupportedDecimals(uint8 shareDecimals, uint8 assetDecimals);

    constructor(address baseCurrency, uint256 baseCurrencyUnit) {
        BASE_CURRENCY = baseCurrency;
        BASE_CURRENCY_UNIT = baseCurrencyUnit;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    /**
     * @notice Registers an ERC4626 vault for pricing
     * @param asset The vault share token to price (must equal the vault address)
     * @param vault The ERC4626 vault address
     */
    function setVault(address asset, address vault) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (vault == address(0)) {
            revert VaultAddressZero();
        }
        if (vault.code.length == 0) {
            revert VaultNotContract(vault);
        }
        if (asset != vault) {
            revert AssetDoesNotMatchVault(asset, vault);
        }

        IERC4626 erc4626Vault = IERC4626(vault);
        uint8 shareDecimals = IERC20Metadata(vault).decimals();
        uint8 assetDecimals = IERC20Metadata(erc4626Vault.asset()).decimals();

        if (shareDecimals == 0 || assetDecimals == 0 || shareDecimals > 18 || assetDecimals > 18) {
            revert UnsupportedDecimals(shareDecimals, assetDecimals);
        }

        assetToVault[asset] = VaultConfig({
            vault: erc4626Vault,
            shareDecimals: shareDecimals,
            assetDecimals: assetDecimals
        });

        emit VaultSet(asset, vault, shareDecimals, assetDecimals);
    }

    /**
     * @notice Removes a vault configuration
     * @param asset The vault share token whose configuration will be removed
     */
    function removeVault(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete assetToVault[asset];
        emit VaultRemoved(asset);
    }

    /**
     * @inheritdoc IOracleWrapperV1_1
     * @dev Price = convertToAssets(1 share) scaled to BASE_CURRENCY_UNIT.
     *      Assumes the underlying asset is 1:1 with base currency.
     */
    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        VaultConfig memory config = assetToVault[asset];
        if (address(config.vault) == address(0)) {
            revert VaultNotSet(asset);
        }

        // Get how many underlying assets 1 share is worth
        uint256 shareUnit = 10 ** config.shareDecimals;
        uint256 assetsPerShare = config.vault.convertToAssets(shareUnit);

        // Scale to BASE_CURRENCY_UNIT
        // assetsPerShare is in asset decimals, we need to convert to BASE_CURRENCY_UNIT
        uint256 assetUnit = 10 ** config.assetDecimals;
        price = (assetsPerShare * BASE_CURRENCY_UNIT) / assetUnit;

        // ERC4626 vaults are always "alive" - no external oracle dependency
        isAlive = price > 0;
    }

    /**
     * @inheritdoc IOracleWrapperV1_1
     */
    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        require(isAlive, "Price not alive");
        return price;
    }
}
