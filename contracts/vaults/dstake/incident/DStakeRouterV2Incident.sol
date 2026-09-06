// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DStakeRouterV2 } from "../DStakeRouterV2.sol";

/**
 * @notice Incident replacement starts paused IN ITS CONSTRUCTOR, before exposure.
 * @dev Non-proxy. Uses the existing token/collateral vault, not new holder shares.
 *      Governance must wire, verify, and separately authorize reopening.
 */
contract DStakeRouterV2Incident is DStakeRouterV2 {
    constructor(address token, address collateral) DStakeRouterV2(token, collateral) {
        _pause();
    }
}
