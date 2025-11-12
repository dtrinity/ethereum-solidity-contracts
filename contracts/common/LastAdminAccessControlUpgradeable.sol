// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { AccessControlEnumerableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title LastAdminAccessControlUpgradeable
 * @notice Upgradeable AccessControl extension that prevents removing the final DEFAULT_ADMIN_ROLE holder.
 */
abstract contract LastAdminAccessControlUpgradeable is AccessControlEnumerableUpgradeable {
    /// @dev Reverted when an action would leave the contract without any DEFAULT_ADMIN_ROLE members.
    error LastAdminRemovalForbidden();

    function __LastAdminAccessControl_init() internal onlyInitializing {
        __AccessControlEnumerable_init();
    }

    function __LastAdminAccessControl_init_unchained() internal onlyInitializing {}

    /**
     * @dev Overrides OZ revokeRole to prevent removing the final admin.
     */
    function revokeRole(
        bytes32 role,
        address account
    ) public virtual override(AccessControlUpgradeable, IAccessControl) onlyRole(getRoleAdmin(role)) {
        _revertIfRemovingLastAdmin(role, account);
        super.revokeRole(role, account);
    }

    /**
     * @dev Overrides OZ renounceRole to prevent the final admin from renouncing.
     */
    function renounceRole(bytes32 role, address account)
        public
        virtual
        override(AccessControlUpgradeable, IAccessControl)
    {
        _revertIfRemovingLastAdmin(role, account);
        super.renounceRole(role, account);
    }

    /**
     * @notice Ensures at least one DEFAULT_ADMIN_ROLE member remains after a role change.
     */
    function _revertIfRemovingLastAdmin(bytes32 role, address account) internal view {
        if (role != DEFAULT_ADMIN_ROLE) {
            return;
        }

        if (!hasRole(role, account)) {
            return;
        }

        if (getRoleMemberCount(DEFAULT_ADMIN_ROLE) <= 1) {
            revert LastAdminRemovalForbidden();
        }
    }
}
