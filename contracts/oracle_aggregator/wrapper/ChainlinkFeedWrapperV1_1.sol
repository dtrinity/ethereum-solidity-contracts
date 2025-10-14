// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseChainlinkWrapperV1_1} from "./BaseChainlinkWrapperV1_1.sol";

/**
 * @dev Concrete Chainlink wrapper leveraging the shared base implementation.
 *      Provides a straightforward constructor for deployments that only require
 *      direct Chainlink feeds without additional composition.
 */
contract ChainlinkFeedWrapperV1_1 is BaseChainlinkWrapperV1_1 {
  constructor(address baseCurrency_, uint256 baseCurrencyUnit_, address initialAdmin)
    BaseChainlinkWrapperV1_1(baseCurrency_, baseCurrencyUnit_, initialAdmin)
  {}
}
