// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

// Minimal mock satisfying what WrappedDLendConversionAdapter needs
contract MockStaticATokenLM is ERC4626 {
    using Math for uint256;

    uint256 public forcedTotalAssets;
    bool public useForcedAssets;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Static AToken", "stATK") {}

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
    function mintDirect(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    // Allow burning shares to reset state or simulate redemptions
    function burnDirect(address from, uint256 amount) external {
        _burn(from, amount);
    }

    // IStaticATokenLM extra methods (stubs)
    function rate() external pure returns (uint256) { return 1e27; }
    function collectAndUpdateRewards(address) external pure returns (uint256) { return 0; }
}
