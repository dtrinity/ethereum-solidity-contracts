// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { RewardClaimable } from "../../rewards_claimable/RewardClaimable.sol";
import { DStakeRouterV2 } from "../DStakeRouterV2.sol";
import { IDStakeCollateralVaultV2 } from "../interfaces/IDStakeCollateralVaultV2.sol";
import { IDStableConversionAdapterV2 } from "../interfaces/IDStableConversionAdapterV2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title IUniversalRewardsDistributor
 * @notice Interface for Morpho's Universal Rewards Distributor
 */
interface IUniversalRewardsDistributor {
    function claim(
        address account,
        address reward,
        uint256 claimable,
        bytes32[] calldata proof
    ) external returns (uint256);

    function claimed(address account, address reward) external view returns (uint256);

    function root() external view returns (bytes32);
}

/**
 * @title IMetaMorpho
 * @notice Extended MetaMorpho interface with reward skimming functionality
 */
interface IMetaMorpho is IERC4626 {
    function skim(address token) external;
    function setSkimRecipient(address newSkimRecipient) external;
    function skimRecipient() external view returns (address);
}

/**
 * @title DStakeRewardManagerMetaMorpho
 * @notice Manages claiming of rewards from MetaMorpho vaults through the Universal Rewards Distributor
 *         and compounds dStable into the DStakeCollateralVaultV2.
 * @dev Implements the RewardClaimable interface.
 *
 *      MetaMorpho reward flow:
 *      1. Rewards accumulate in MetaMorpho vault from underlying Morpho Blue markets
 *      2. Anyone can call skim() to transfer rewards to the skimRecipient (URD)
 *      3. URD computes Merkle trees off-chain for fair distribution
 *      4. Users claim rewards via Merkle proofs
 *      5. This contract automates the claiming and compounding process
 *
 *      Note: Unlike dLEND which has on-chain reward accrual, MetaMorpho relies on
 *      off-chain computation and API integration for reward distribution.
 */
contract DStakeRewardManagerMetaMorpho is RewardClaimable {
    using SafeERC20 for IERC20;

    // --- State ---
    address public immutable dStakeCollateralVault;
    DStakeRouterV2 public immutable dStakeRouter;
    IMetaMorpho public immutable metaMorphoVault;
    IUniversalRewardsDistributor public urd; // Can be updated by admin

    // Reward claim data (updated off-chain via API)
    struct ClaimData {
        address rewardToken;
        uint256 claimableAmount;
        bytes32[] proof;
    }

    // --- Events ---
    event URDUpdated(address oldURD, address newURD);
    event RewardsSkimmed(address indexed token, uint256 amount);
    event RewardsClaimed(address indexed token, uint256 amount);
    event ExchangeAssetProcessed(
        address indexed strategyShare,
        uint256 strategyShareAmount,
        uint256 dStableCompoundedAmount
    );
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed recipient);

    // --- Errors ---
    error InvalidRouter();
    error InvalidAdapter(address adapter);
    error AdapterReturnedUnexpectedAsset(address expected, address actual);
    error InsufficientAssetsReceived(uint256 expected, uint256 actual);
    error DefaultDepositAssetNotSet();
    error AdapterNotSetForDefaultAsset();
    error InvalidURD();
    error ClaimFailed(address token);
    error SkimRecipientMismatch();
    error ZeroAddress();

    // --- Constructor ---
    constructor(
        address _dStakeCollateralVault,
        address _dStakeRouter,
        address _metaMorphoVault,
        address _urd,
        address _treasury,
        uint256 _maxTreasuryFeeBps,
        uint256 _initialTreasuryFeeBps,
        uint256 _initialExchangeThreshold
    )
        RewardClaimable(
            IDStakeCollateralVaultV2(_dStakeCollateralVault).dStable(), // exchangeAsset is dStable
            _treasury,
            _maxTreasuryFeeBps,
            _initialTreasuryFeeBps,
            _initialExchangeThreshold
        )
    {
        if (_dStakeCollateralVault == address(0) || _dStakeRouter == address(0) || _metaMorphoVault == address(0)) {
            revert ZeroAddress();
        }
        if (exchangeAsset == address(0)) {
            revert InvalidRouter();
        }

        dStakeCollateralVault = _dStakeCollateralVault;
        dStakeRouter = DStakeRouterV2(_dStakeRouter);
        metaMorphoVault = IMetaMorpho(_metaMorphoVault);

        if (_urd != address(0)) {
            urd = IUniversalRewardsDistributor(_urd);
        }

        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REWARDS_MANAGER_ROLE, msg.sender);
    }

    // --- Admin Functions ---

    /**
     * @notice Updates the Universal Rewards Distributor address
     * @param newURD The new URD address (can be 0 to disable)
     */
    function setURD(address newURD) external onlyRole(REWARDS_MANAGER_ROLE) {
        // Validate URD interface if non-zero
        if (newURD != address(0)) {
            // Basic interface check - try to call a view function
            try IUniversalRewardsDistributor(newURD).root() returns (bytes32) {
                // Interface check passed
            } catch {
                revert InvalidURD();
            }
        }

        address oldURD = address(urd);
        urd = newURD == address(0) ? IUniversalRewardsDistributor(address(0)) : IUniversalRewardsDistributor(newURD);
        emit URDUpdated(oldURD, newURD);
    }

    /**
     * @notice Sets this contract as the skim recipient for the MetaMorpho vault
     * @dev Only needed if rewards should flow through this contract first
     */
    function becomeSkimRecipient() external onlyRole(REWARDS_MANAGER_ROLE) {
        metaMorphoVault.setSkimRecipient(address(this));
    }

    // --- Reward Management Functions ---

    /**
     * @notice Skims accumulated rewards from the MetaMorpho vault
     * @param tokens Array of reward token addresses to skim
     * @dev Restricted to REWARDS_MANAGER_ROLE to prevent griefing
     */
    function skimRewards(address[] calldata tokens) external onlyRole(REWARDS_MANAGER_ROLE) nonReentrant {
        // Cache skim recipient to save gas on multiple token skims
        address recipient = metaMorphoVault.skimRecipient();

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balanceBefore = IERC20(tokens[i]).balanceOf(recipient);
            metaMorphoVault.skim(tokens[i]);
            uint256 balanceAfter = IERC20(tokens[i]).balanceOf(recipient);

            if (balanceAfter > balanceBefore) {
                emit RewardsSkimmed(tokens[i], balanceAfter - balanceBefore);
            }
        }
    }

    /**
     * @notice Claims rewards from the URD on behalf of the collateral vault
     * @param claimData Array of claim data including tokens, amounts, and proofs
     * @dev Claim data must be obtained from Morpho Rewards API
     * @dev Claims rewards to this contract for processing and distribution
     */
    function claimRewardsFromURD(ClaimData[] calldata claimData) external onlyRole(REWARDS_MANAGER_ROLE) {
        if (address(urd) == address(0)) {
            revert InvalidURD();
        }

        for (uint256 i = 0; i < claimData.length; i++) {
            uint256 balanceBefore = IERC20(claimData[i].rewardToken).balanceOf(address(this));

            try
                urd.claim(
                    address(this), // Claim rewards to this contract for processing
                    claimData[i].rewardToken,
                    claimData[i].claimableAmount,
                    claimData[i].proof
                )
            returns (uint256 claimed) {
                // Verify rewards were actually received
                uint256 balanceAfter = IERC20(claimData[i].rewardToken).balanceOf(address(this));
                uint256 actualReceived = balanceAfter - balanceBefore;

                if (actualReceived == 0 && claimed > 0) {
                    revert ClaimFailed(claimData[i].rewardToken);
                }

                emit RewardsClaimed(claimData[i].rewardToken, actualReceived > 0 ? actualReceived : claimed);
            } catch {
                revert ClaimFailed(claimData[i].rewardToken);
            }
        }
    }

    // --- RewardClaimable Implementation ---

    /**
     * @notice Claims specified reward tokens earned by the MetaMorpho vault
     * @param rewardTokens Array of reward token addresses to claim
     * @return actualAmounts The actual amounts claimed for each token
     */
    function _claimRewards(
        address[] calldata rewardTokens,
        address /* receiver */
    ) internal override returns (uint256[] memory actualAmounts) {
        // MetaMorpho rewards are claimed externally via URD
        // This function returns the amounts that were already claimed and are held in this contract
        // Note: receiver parameter is not used as rewards are already in this contract from URD claims

        actualAmounts = new uint256[](rewardTokens.length);

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            // Check balance of reward tokens in this contract
            // These should have been claimed via claimRewardsFromURD
            actualAmounts[i] = IERC20(rewardTokens[i]).balanceOf(address(this));
        }

        return actualAmounts;
    }

    /**
     * @notice Processes the exchange asset (dStable) and compounds it into the vault
     * @param exchangeAmountIn The amount of dStable to compound
     */
    function _processExchangeAssetDeposit(uint256 exchangeAmountIn) internal override {
        // Get the router's default deposit strategy share
        address defaultStrategyShare = dStakeRouter.defaultDepositStrategyShare();
        if (defaultStrategyShare == address(0)) {
            revert DefaultDepositAssetNotSet();
        }

        // Get the adapter for the default strategy share
        address adapter = dStakeRouter.strategyShareToAdapter(defaultStrategyShare);
        if (adapter == address(0)) {
            revert AdapterNotSetForDefaultAsset();
        }

        // Approve adapter to spend dStable
        IERC20(exchangeAsset).forceApprove(adapter, exchangeAmountIn);

        // Check collateral vault balance before conversion
        uint256 balanceBefore = IERC20(defaultStrategyShare).balanceOf(dStakeCollateralVault);

        // Convert dStable to strategy share via adapter
        (address returnedStrategyShare, uint256 strategyShareAmount) = IDStableConversionAdapterV2(adapter)
            .depositIntoStrategy(exchangeAmountIn);

        // Verify the adapter returned the expected strategy share
        if (returnedStrategyShare != defaultStrategyShare) {
            revert AdapterReturnedUnexpectedAsset(defaultStrategyShare, returnedStrategyShare);
        }

        // Verify that the collateral vault actually received the expected assets
        uint256 balanceAfter = IERC20(defaultStrategyShare).balanceOf(dStakeCollateralVault);
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived < strategyShareAmount) {
            revert InsufficientAssetsReceived(strategyShareAmount, actualReceived);
        }

        // Emit event for tracking (use actualReceived for accuracy)
        emit ExchangeAssetProcessed(defaultStrategyShare, actualReceived, exchangeAmountIn);

        // Clear any remaining approval now that the transfer has completed
        IERC20(exchangeAsset).forceApprove(adapter, 0);
    }

    /**
     * @notice Emergency function to recover stuck tokens
     * @param token The token to recover
     * @param amount The amount to recover
     * @dev Only callable by admin
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury == address(0)) {
            revert ZeroAddress();
        }
        IERC20(token).safeTransfer(treasury, amount);
        emit EmergencyWithdraw(token, amount, treasury);
    }

    // --- View Functions ---

    /**
     * @notice Checks if the URD has been configured
     * @return True if URD is set
     */
    function isURDConfigured() external view returns (bool) {
        return address(urd) != address(0);
    }

    /**
     * @notice Gets the current skim recipient of the MetaMorpho vault
     * @return The address receiving skimmed rewards
     */
    function currentSkimRecipient() external view returns (address) {
        return metaMorphoVault.skimRecipient();
    }

    /**
     * @notice Checks how much of a reward token has been claimed by this contract
     * @param rewardToken The reward token to check
     * @return The amount already claimed
     */
    function getClaimedAmount(address rewardToken) external view returns (uint256) {
        if (address(urd) == address(0)) {
            return 0;
        }
        return urd.claimed(address(this), rewardToken);
    }
}
