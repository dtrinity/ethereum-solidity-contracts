// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract IncidentMintableERC20 is ERC20 {
    constructor() ERC20("Incident Test Asset", "ITA") {}
    function mint(address receiver, uint256 amount) external { _mint(receiver, amount); }
}

/**
 * @notice Local invariant-test fixture, NOT a production strategy.
 * @dev No flash funding, target mainnet addresses, extraction routine, or profit
 *      loop. Controls exercise disagreement between quantities and backing.
 */
contract IncidentAccountingVault is ERC4626 {
    using SafeERC20 for IERC20;
    uint8 public mode; // 0 honest; 1 agreed zero shares; 2 agreed tiny shares
    uint256 public depositLoss;
    uint256 public withdrawalLoss;
    uint256 public withdrawalOverreport;

    constructor(IERC20 asset_) ERC20("Incident Test Shares", "ITS") ERC4626(asset_) {}

    function configure(uint8 mode_, uint256 depositLoss_, uint256 withdrawalLoss_, uint256 overreport_) external {
        mode = mode_;
        depositLoss = depositLoss_;
        withdrawalLoss = withdrawalLoss_;
        withdrawalOverreport = overreport_;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        // The router health probe must not replace checks on the actual amount.
        if (assets == 1e18) return super.previewDeposit(assets);
        if (mode == 1) return 0;
        if (mode == 2) return 1;
        return super.previewDeposit(assets);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        return mode == 2 ? shares * 100 : super.previewMint(shares);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        if (depositLoss != 0) IERC20(asset()).safeTransfer(address(0xdead), depositLoss);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        super._withdraw(caller, receiver, owner, assets, shares);
        if (withdrawalLoss != 0) IERC20(asset()).safeTransfer(address(0xdead), withdrawalLoss);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        return super.redeem(shares, receiver, owner) + withdrawalOverreport;
    }
}


contract IncidentLegacyModuleMetadata {
    address private immutable token;
    address private immutable collateral;
    constructor(address token_, address collateral_) { token = token_; collateral = collateral_; }
    function moduleMetadata() external view returns (bytes32, address, address) {
        return (keccak256("dtrinity.dstake.router.v2.storage:1"), token, collateral);
    }
}
