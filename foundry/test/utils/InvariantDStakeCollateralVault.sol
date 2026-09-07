// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStakeCollateralVaultV2 } from "vaults/dstake/interfaces/IDStakeCollateralVaultV2.sol";
import { IDStableConversionAdapterV2 } from "vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";

interface IInvariantAdapterProvider {
    function strategyShareToAdapter(address strategyShare) external view returns (address);
}

/// @notice Lightweight collateral vault used in invariants to emulate strategy share custody.
contract InvariantDStakeCollateralVault is IDStakeCollateralVaultV2 {
    using SafeERC20 for IERC20;

    address public immutable override dStable;
    address public owner;

    address private _dStakeToken;
    address private _router;

    uint256 private _totalValue;
    bool private _liveValuation;
    address[] private _supportedShares;
    mapping(address => bool) private _isSupported;

    error NotOwner();
    error NotRouter();
    error ShareNotSupported(address share);
    error AdapterValuationUnavailable(address share);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address stable) {
        dStable = stable;
        owner = msg.sender;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setDStakeToken(address token) external onlyOwner {
        _dStakeToken = token;
    }

    function setRouter(address newRouter) external onlyOwner {
        _router = newRouter;
    }

    function setTotalValue(uint256 newValue) external onlyOwner {
        _totalValue = newValue;
    }

    function setLiveValuation(bool enabled) external onlyOwner {
        _liveValuation = enabled;
    }

    function addSupportedStrategyShare(address share) external onlyOwner {
        if (_isSupported[share]) {
            return;
        }
        _supportedShares.push(share);
        _isSupported[share] = true;
    }

    function removeSupportedStrategyShare(address share) external onlyOwner {
        if (!_isSupported[share]) {
            return;
        }
        _isSupported[share] = false;

        for (uint256 i = 0; i < _supportedShares.length; i++) {
            if (_supportedShares[i] == share) {
                _supportedShares[i] = _supportedShares[_supportedShares.length - 1];
                _supportedShares.pop();
                break;
            }
        }
    }

    function transferStrategyShares(address share, uint256 amount, address recipient) external override {
        if (msg.sender != _router) revert NotRouter();
        if (!_isSupported[share]) revert ShareNotSupported(share);
        IERC20(share).safeTransfer(recipient, amount);
    }

    function supportedStrategyShares(uint256 index) external view override returns (address) {
        return _supportedShares[index];
    }

    function getSupportedStrategyShares() external view override returns (address[] memory) {
        return _supportedShares;
    }

    function totalValueInDStable() external view override returns (uint256) {
        if (!_liveValuation) return _totalValue;

        uint256 totalValue;
        for (uint256 i = 0; i < _supportedShares.length; i++) {
            address share = _supportedShares[i];
            uint256 balance = IERC20(share).balanceOf(address(this));
            if (balance == 0) continue;

            address adapter = IInvariantAdapterProvider(_router).strategyShareToAdapter(share);
            if (adapter == address(0)) revert AdapterValuationUnavailable(share);
            totalValue += IDStableConversionAdapterV2(adapter).strategyShareValueInDStable(share, balance);
        }
        return totalValue;
    }

    function dStakeToken() external view override returns (address) {
        return _dStakeToken;
    }

    function router() external view override returns (address) {
        return _router;
    }
}
