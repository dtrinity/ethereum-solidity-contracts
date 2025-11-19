// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract MockMetaMorphoVault is ERC4626 {
    using Math for uint256;

    uint256 public forcedTotalAssets;
    bool public useForcedAssets;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Morpho", "mmUSDC") {}

    function setTotalAssets(uint256 assets) external {
        forcedTotalAssets = assets;
        useForcedAssets = true;
    }

    function totalAssets() public view override returns (uint256) {
        if (useForcedAssets) {
            return forcedTotalAssets;
        }
        return super.totalAssets();
    }

    // Allow minting shares directly to simulate other users interacting with the vault
    // changing the exchange rate
    function mintDirect(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
