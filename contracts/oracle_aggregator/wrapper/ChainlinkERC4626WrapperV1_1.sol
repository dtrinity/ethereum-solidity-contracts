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

import "../interface/chainlink/BaseChainlinkWrapperV1_1.sol";
import "../interface/chainlink/IPriceFeed.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title ChainlinkERC4626WrapperV1_1
 * @notice Composes a Chainlink-style price feed for an ERC4626 vault's underlying asset with the vault exchange rate.
 * @dev Price(asset) = convertToAssets(1 share) * Chainlink(underlying/base) / underlyingUnit, scaled to BASE_CURRENCY_UNIT.
 */
contract ChainlinkERC4626WrapperV1_1 is BaseChainlinkWrapperV1_1 {
    struct ERC4626FeedConfig {
        IPriceFeed priceFeed; // Chainlink-style feed for the vault's underlying asset
        IERC4626 vault; // ERC4626 vault representing the priced asset
        uint8 assetDecimals; // decimals of the underlying asset
        uint8 shareDecimals; // decimals of the vault share token (the priced asset)
    }

    mapping(address => ERC4626FeedConfig) public erc4626Feeds;

    /* Events */

    event ERC4626FeedSet(
        address indexed asset,
        address indexed vault,
        address indexed priceFeed,
        uint8 assetDecimals,
        uint8 shareDecimals
    );
    event ERC4626FeedRemoved(address indexed asset);

    /* Errors */

    error AssetAddressZero();
    error FeedAddressZero();
    error FeedNotContract(address feed);
    error VaultNotContract(address vault);
    error AssetDoesNotMatchVault(address asset, address vault);
    error UnsupportedDecimals(uint8 assetDecimals, uint8 shareDecimals);
    error UnexpectedFeedDecimals(uint8 expected, uint8 actual);

    constructor(
        address baseCurrency,
        uint256 _baseCurrencyUnit
    ) BaseChainlinkWrapperV1_1(baseCurrency, _baseCurrencyUnit) {}

    /**
     * @notice Registers a Chainlink + ERC4626 feed for a vault share token.
     * @param asset The vault share token to price (must equal the vault address)
     * @param vault The ERC4626 vault that defines the exchange rate
     * @param priceFeed The Chainlink-style feed for the vault's underlying asset priced in base currency
     */
    function setERC4626Feed(address asset, address vault, address priceFeed) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (asset == address(0)) {
            revert AssetAddressZero();
        }
        if (vault == address(0)) {
            revert AssetAddressZero();
        }
        if (priceFeed == address(0)) {
            revert FeedAddressZero();
        }
        if (asset != vault) {
            revert AssetDoesNotMatchVault(asset, vault);
        }
        if (vault.code.length == 0) {
            revert VaultNotContract(vault);
        }
        if (priceFeed.code.length == 0) {
            revert FeedNotContract(priceFeed);
        }

        uint8 feedDecimals = IPriceFeed(priceFeed).decimals();
        if (feedDecimals != 8) {
            revert UnexpectedFeedDecimals(8, feedDecimals);
        }

        IERC4626 erc4626Vault = IERC4626(vault);
        address underlying = erc4626Vault.asset();
        uint8 assetDecimals = IERC20Metadata(underlying).decimals();
        uint8 shareDecimals = IERC20Metadata(vault).decimals();

        // Limit to typical ERC20 decimals to avoid overflow when scaling units
        if (assetDecimals == 0 || shareDecimals == 0 || assetDecimals > 18 || shareDecimals > 18) {
            revert UnsupportedDecimals(assetDecimals, shareDecimals);
        }

        erc4626Feeds[asset] = ERC4626FeedConfig({
            priceFeed: IPriceFeed(priceFeed),
            vault: erc4626Vault,
            assetDecimals: assetDecimals,
            shareDecimals: shareDecimals
        });

        emit ERC4626FeedSet(asset, vault, priceFeed, assetDecimals, shareDecimals);
    }

    /**
     * @notice Removes an ERC4626 feed configuration
     * @param asset The vault share token whose configuration will be removed
     */
    function removeERC4626Feed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete erc4626Feeds[asset];
        emit ERC4626FeedRemoved(asset);
    }

    /**
     * @inheritdoc BaseChainlinkWrapperV1_1
     */
    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        ERC4626FeedConfig memory config = erc4626Feeds[asset];
        if (address(config.vault) == address(0)) {
            revert FeedNotSet(asset);
        }

        (, int256 answer, , uint256 updatedAt, ) = config.priceFeed.latestRoundData();
        if (answer <= 0) {
            revert InvalidPrice();
        }

        uint256 assetsPerShare = config.vault.convertToAssets(_shareUnit(config.shareDecimals));
        uint256 underlyingPriceInBase = _convertToBaseCurrencyUnit(uint256(answer));

        price = (underlyingPriceInBase * assetsPerShare) / _assetUnit(config.assetDecimals);
        isAlive =
            price > 0 &&
            updatedAt + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
    }

    function _shareUnit(uint8 shareDecimals) private pure returns (uint256) {
        return 10 ** shareDecimals;
    }

    function _assetUnit(uint8 assetDecimals) private pure returns (uint256) {
        return 10 ** assetDecimals;
    }
}
