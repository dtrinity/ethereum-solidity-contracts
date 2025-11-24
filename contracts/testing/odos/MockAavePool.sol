// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IAaveFlashLoanReceiver } from "contracts/dlend/periphery/adapters/curve/interfaces/IAaveFlashLoanReceiver.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";

contract MockAavePool {
    using SafeERC20 for IERC20;

    struct ReserveAddresses {
        address aToken;
        address stableDebt;
        address variableDebt;
    }

    address public immutable ADDRESSES_PROVIDER;
    uint256 public flashLoanPremiumTotal;
    mapping(address => ReserveAddresses) private reserves;
    address[] private reserveList;

    constructor(address addressesProvider) {
        ADDRESSES_PROVIDER = addressesProvider;
    }

    function setReserveData(address asset, address aToken, address stableDebt, address variableDebt) external {
        reserves[asset] = ReserveAddresses({ aToken: aToken, stableDebt: stableDebt, variableDebt: variableDebt });

        bool exists;
        for (uint256 i = 0; i < reserveList.length; i++) {
            if (reserveList[i] == asset) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            reserveList.push(asset);
        }
    }

    function setFlashLoanPremiumTotal(uint256 premium) external {
        flashLoanPremiumTotal = premium;
    }

    function getReservesList() external view returns (address[] memory) {
        return reserveList;
    }

    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory data) {
        ReserveAddresses memory reserveAddresses = reserves[asset];
        data.aTokenAddress = reserveAddresses.aToken;
        data.stableDebtTokenAddress = reserveAddresses.stableDebt;
        data.variableDebtTokenAddress = reserveAddresses.variableDebt;
    }

    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata /*interestRateModes*/,
        address onBehalfOf,
        bytes calldata params,
        uint16 /*referralCode*/
    ) external {
        uint256[] memory premiums = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amount = amounts[i];
            IERC20(assets[i]).safeTransfer(receiverAddress, amount);
            premiums[i] = (amount * flashLoanPremiumTotal) / 10000;
        }

        require(
            IAaveFlashLoanReceiver(receiverAddress).executeOperation(assets, amounts, premiums, onBehalfOf, params),
            "FLASHLOAN_CALLBACK_FAILED"
        );

        for (uint256 i = 0; i < assets.length; i++) {
            IERC20(assets[i]).safeTransferFrom(receiverAddress, address(this), amounts[i] + premiums[i]);
        }
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }

    function repay(
        address asset,
        uint256 amount,
        uint256 /*rateMode*/,
        address /*onBehalfOf*/
    ) external returns (uint256) {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        return amount;
    }

    function borrow(
        address asset,
        uint256 amount,
        uint256 /*rateMode*/,
        uint16 /*referralCode*/,
        address /*onBehalfOf*/
    ) external {
        IERC20(asset).safeTransfer(msg.sender, amount);
    }
}
