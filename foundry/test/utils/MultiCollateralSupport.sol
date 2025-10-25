// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { TestMintableERC20 } from "./TestMintableERC20.sol";
import { IPriceOracleGetter } from "common/IAaveOracle.sol";

/// @notice Helper utilities for handling heterogeneous collateral assets in Foundry invariants.
library MultiCollateralSupport {
    struct CollateralAsset {
        TestMintableERC20 token;
    }

    function addr(CollateralAsset storage asset) internal view returns (address) {
        return address(asset.token);
    }

    function decimals(CollateralAsset storage asset) internal view returns (uint8) {
        return asset.token.decimals();
    }

    function toBaseValue(
        IPriceOracleGetter oracle,
        CollateralAsset storage asset,
        uint256 amount
    ) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 price = oracle.getAssetPrice(addr(asset));
        return Math.mulDiv(price, amount, 10 ** decimals(asset));
    }
}
