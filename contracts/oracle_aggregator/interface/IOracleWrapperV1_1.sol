// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OracleBaseV1_1 } from "../OracleBaseV1_1.sol";

interface IOracleWrapperV1_1 {
  function BASE_CURRENCY() external view returns (address);

  function BASE_CURRENCY_UNIT() external view returns (uint256);

  function getAssetPrice(address asset) external view returns (uint256);

  function getPriceInfo(address asset) external view returns (OracleBaseV1_1.PriceData memory priceData);
}
