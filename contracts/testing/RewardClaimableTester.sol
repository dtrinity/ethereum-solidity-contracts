// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/vaults/rewards_claimable/RewardClaimable.sol";
import "contracts/common/IMintableERC20.sol";

/// @notice Harness contract extending RewardClaimable for invariant testing.
contract RewardClaimableTester is RewardClaimable {
    using SafeERC20 for IERC20;

    enum DepositBehavior {
        Forward,
        Hold,
        Reenter
    }

    struct RewardConfig {
        bool configured;
        uint256 emission;
        bool revertOnClaim;
    }

    mapping(address => RewardConfig) private rewardConfigs;
    address[] private configuredRewards;

    DepositBehavior public depositBehavior;
    address public depositSink;
    bytes public reenterCalldata;

    mapping(address => uint256) public totalRewardsClaimed;
    uint256 public totalExchangeAssetProcessed;
    uint256 public totalExchangeAssetForwarded;
    uint256 public reentrancyAttempts;
    bool public lastReentrancyCallSucceeded;
    bytes public lastReentrancyRevertData;

    error RewardAlreadyConfigured(address token);
    error RewardNotConfigured(address token);
    error DepositSinkNotSet();
    error ReentrancyCallDataMissing();
    error ReentrancyDidNotRevert();
    error RewardClaimReverted(address token);

    event RewardConfigured(address indexed token, uint256 emission, bool revertOnClaim);
    event RewardEmissionUpdated(address indexed token, uint256 emission);
    event RewardRevertFlagUpdated(address indexed token, bool revertOnClaim);
    event DepositSinkUpdated(address indexed sink);
    event DepositBehaviorUpdated(DepositBehavior behavior);
    event ReenterCalldataUpdated(bytes data);

    constructor(
        address exchangeAsset_,
        address treasury_,
        uint256 maxTreasuryFeeBps_,
        uint256 initialTreasuryFeeBps_,
        uint256 initialExchangeThreshold_,
        address depositSink_
    )
        RewardClaimable(
            exchangeAsset_,
            treasury_,
            maxTreasuryFeeBps_,
            initialTreasuryFeeBps_,
            initialExchangeThreshold_
        )
    {
        depositBehavior = DepositBehavior.Forward;
        depositSink = depositSink_;
    }

    // -------------------------------------------------------------------------
    // Harness configuration
    // -------------------------------------------------------------------------

    function configureRewardToken(address token, uint256 emission, bool revertOnClaim) external onlyRole(DEFAULT_ADMIN_ROLE) {
        RewardConfig storage config = rewardConfigs[token];
        if (config.configured) {
            revert RewardAlreadyConfigured(token);
        }

        config.configured = true;
        config.emission = emission;
        config.revertOnClaim = revertOnClaim;
        configuredRewards.push(token);

        emit RewardConfigured(token, emission, revertOnClaim);
    }

    function setRewardEmission(address token, uint256 emission) external onlyRole(DEFAULT_ADMIN_ROLE) {
        RewardConfig storage config = rewardConfigs[token];
        if (!config.configured) {
            revert RewardNotConfigured(token);
        }

        config.emission = emission;
        emit RewardEmissionUpdated(token, emission);
    }

    function setRewardRevertFlag(address token, bool revertOnClaim) external onlyRole(DEFAULT_ADMIN_ROLE) {
        RewardConfig storage config = rewardConfigs[token];
        if (!config.configured) {
            revert RewardNotConfigured(token);
        }

        config.revertOnClaim = revertOnClaim;
        emit RewardRevertFlagUpdated(token, revertOnClaim);
    }

    function rewardTokenCount() external view returns (uint256) {
        return configuredRewards.length;
    }

    function rewardTokenAt(uint256 index) external view returns (address) {
        return configuredRewards[index];
    }

    function rewardTokens() external view returns (address[] memory tokens) {
        uint256 length = configuredRewards.length;
        tokens = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            tokens[i] = configuredRewards[i];
        }
    }

    function setDepositBehavior(DepositBehavior behavior) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositBehavior = behavior;
        emit DepositBehaviorUpdated(behavior);
    }

    function setDepositSink(address sink) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositSink = sink;
        emit DepositSinkUpdated(sink);
    }

    function setReenterCalldata(bytes calldata data) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reenterCalldata = data;
        emit ReenterCalldataUpdated(data);
    }

    // -------------------------------------------------------------------------
    // RewardClaimable hooks
    // -------------------------------------------------------------------------

    function _claimRewards(
        address[] calldata tokens,
        address receiver
    ) internal override returns (uint256[] memory rewardAmounts) {
        rewardAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            RewardConfig storage config = rewardConfigs[tokens[i]];
            if (!config.configured) {
                revert RewardNotConfigured(tokens[i]);
            }
            if (config.revertOnClaim) {
                revert RewardClaimReverted(tokens[i]);
            }

            uint256 emission = config.emission;
            if (emission > 0) {
                IMintableERC20(tokens[i]).mint(receiver, emission);
            }

            rewardAmounts[i] = emission;
            totalRewardsClaimed[tokens[i]] += emission;
        }
    }

    function _processExchangeAssetDeposit(uint256 amount) internal override {
        totalExchangeAssetProcessed += amount;

        if (depositBehavior == DepositBehavior.Hold) {
            return;
        }

        if (depositSink == address(0)) {
            revert DepositSinkNotSet();
        }

        if (depositBehavior == DepositBehavior.Reenter) {
            if (reenterCalldata.length == 0) {
                revert ReentrancyCallDataMissing();
            }

            reentrancyAttempts += 1;
            (bool success, bytes memory returndata) = address(this).call(reenterCalldata);
            lastReentrancyCallSucceeded = success;
            lastReentrancyRevertData = returndata;

            if (success) {
                revert ReentrancyDidNotRevert();
            }
        }

        IERC20(exchangeAsset).safeTransfer(depositSink, amount);
        totalExchangeAssetForwarded += amount;
    }
}
