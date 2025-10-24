// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStableConversionAdapterV2 } from "vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";

/// @notice Vanilla adapter that exchanges dStable <> strategy share at a fixed 1:1 rate.
contract InvariantStableAdapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    IERC20 public immutable dStable;
    address public immutable collateralVault;
    StrategyShare public immutable strategyShareToken;

    constructor(address stable, address vault) {
        dStable = IERC20(stable);
        collateralVault = vault;
        strategyShareToken = new StrategyShare();
    }

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        dStable.safeTransferFrom(msg.sender, address(this), stableAmount);
        strategyShareToken.mint(collateralVault, stableAmount);
        return (address(strategyShareToken), stableAmount);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        strategyShareToken.transferFrom(msg.sender, address(this), strategyShareAmount);
        strategyShareToken.burn(strategyShareAmount);
        dStable.safeTransfer(msg.sender, strategyShareAmount);
        return strategyShareAmount;
    }

    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        return (address(strategyShareToken), stableAmount);
    }

    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) external pure override returns (uint256 stableAmount) {
        return strategyShareAmount;
    }

    function strategyShareValueInDStable(
        address strategyShareAddr,
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableValue) {
        require(strategyShareAddr == address(strategyShareToken), "InvariantAdapter: wrong share");
        return strategyShareAmount;
    }

    function strategyShare() external view override returns (address) {
        return address(strategyShareToken);
    }

    function vaultAsset() external view override returns (address) {
        return address(strategyShareToken);
    }
}

/// @notice Simple ERC20 share token with mint/burn restricted to its owner (the adapter).
contract StrategyShare is ERC20 {
    address public owner;

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() ERC20("Invariant Strategy Share", "iSS") {
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external onlyOwner {
        _burn(address(this), amount);
    }
}
