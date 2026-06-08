// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IPoolAddressesProvider } from "../interfaces/IPoolAddressesProvider.sol";
import { IPoolConfigurator } from "../interfaces/IPoolConfigurator.sol";

/**
 * @title DlendFreezeGuardian
 * @notice Freeze-only dLEND operational guard controlled by a dedicated multisig.
 * @dev Grant this contract RISK_ADMIN_ROLE only. Do not grant POOL_ADMIN_ROLE or EMERGENCY_ADMIN_ROLE.
 */
contract DlendFreezeGuardian is Ownable {
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

    event ReserveFreezeRequested(address indexed asset, address indexed caller);

    error ZeroAddress();

    constructor(IPoolAddressesProvider addressesProvider, address owner) Ownable(owner) {
        if (address(addressesProvider) == address(0) || owner == address(0)) {
            revert ZeroAddress();
        }

        ADDRESSES_PROVIDER = addressesProvider;
    }

    /**
     * @notice Freezes one dLEND reserve.
     * @param asset The underlying reserve asset to freeze.
     */
    function freezeReserve(address asset) external onlyOwner {
        _freezeReserve(asset);
    }

    /**
     * @notice Freezes multiple dLEND reserves.
     * @param assets The underlying reserve assets to freeze.
     */
    function freezeReserves(address[] calldata assets) external onlyOwner {
        for (uint256 i = 0; i < assets.length; i++) {
            _freezeReserve(assets[i]);
        }
    }

    function _freezeReserve(address asset) internal {
        if (asset == address(0)) {
            revert ZeroAddress();
        }

        IPoolConfigurator(ADDRESSES_PROVIDER.getPoolConfigurator()).setReserveFreeze(asset, true);
        emit ReserveFreezeRequested(asset, msg.sender);
    }
}
