// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title MockMetaMorphoVault
 * @notice Mock implementation of a MetaMorpho vault for testing
 * @dev Simulates a MetaMorpho vault with configurable yield generation and rewards
 *      This mock allows testing of integrations without deploying to mainnet
 *
 *      IMPORTANT - Reward Handling Architecture:
 *      Real MetaMorpho vaults do not handle rewards directly within the vault contract.
 *      Instead, rewards are managed externally through:
 *      1. Universal Rewards Distributor (URD) contracts
 *      2. Curator incentive programs
 *      3. Other external reward mechanisms
 *
 *      In our dSTAKE integration, MetaMorpho rewards are handled by the
 *      DStakeRewardManagerMetaMorpho contract, not by the conversion adapter.
 *      This mock includes basic reward tracking functions for testing scenarios
 *      but should not be confused with production reward handling.
 */
contract MockMetaMorphoVault is ERC4626 {
    using Math for uint256;

    // --- State ---
    uint256 public mockTotalAssets;
    uint256 public yieldRate = 10000; // 100% APY in basis points (for easy testing)
    uint256 public lastYieldUpdate;
    address public owner;

    // Tracking for security testing
    mapping(address => uint256) public lastDepositTimestamp;

    // Mock reward tracking (for testing reward scenarios)
    mapping(address => uint256) public pendingRewards;
    address public rewardToken;
    uint256 public rewardRate; // rewards per second per share

    // Mock skim recipient for MetaMorpho compatibility
    address public skimRecipient;

    // Mock behaviors for testing edge cases
    bool public mockPaused = false;
    bool public mockRevertOnDeposit = false;
    bool public mockRevertOnWithdraw = false;
    bool public mockRevertOnPreviewRedeem = false;
    bool public mockRevertOnConvertToAssets = false;
    uint256 public mockDepositFee = 0; // in basis points
    uint256 public mockWithdrawFee = 0; // in basis points
    bool public mockDepositLimitEnabled = false;
    uint256 public mockDepositLimit;

    // --- Events ---
    event YieldAccrued(uint256 amount);
    event MockBehaviorSet(string behavior, bool value);
    event RewardsClaimed(address indexed user, uint256 amount);
    event DepositLimitUpdated(uint256 limit, bool enabled);

    // --- Constructor ---
    constructor(IERC20 _asset, string memory _name, string memory _symbol) ERC20(_name, _symbol) ERC4626(_asset) {
        lastYieldUpdate = block.timestamp;
        owner = msg.sender;
    }

    // --- Mock Controls ---

    /**
     * @notice Set the yield rate for testing
     * @param _rate Yield rate in basis points (10000 = 100% APY)
     */
    function setYieldRate(uint256 _rate) external {
        yieldRate = _rate;
    }

    /**
     * @notice Pause the vault for testing error conditions
     */
    function setPaused(bool _paused) external {
        mockPaused = _paused;
        emit MockBehaviorSet("paused", _paused);
    }

    /**
     * @notice Set mock fees for testing
     */
    function setFees(uint256 _depositFee, uint256 _withdrawFee) external {
        require(_depositFee <= 1000, "Fee too high"); // Max 10%
        require(_withdrawFee <= 1000, "Fee too high"); // Max 10%
        mockDepositFee = _depositFee;
        mockWithdrawFee = _withdrawFee;
    }

    /**
     * @notice Set revert behaviors for testing error handling
     */
    function setRevertBehaviors(bool _revertOnDeposit, bool _revertOnWithdraw) external {
        mockRevertOnDeposit = _revertOnDeposit;
        mockRevertOnWithdraw = _revertOnWithdraw;
        emit MockBehaviorSet("revertOnDeposit", _revertOnDeposit);
        emit MockBehaviorSet("revertOnWithdraw", _revertOnWithdraw);
    }

    /**
     * @notice Configure the mocked deposit limit used by maxDeposit/preview checks.
     * @param limit Maximum total assets the vault is willing to hold when enabled.
     * @param enabled Toggle to activate or disable the mocked limit.
     */
    function setDepositLimit(uint256 limit, bool enabled) external {
        require(msg.sender == owner, "Not owner");
        mockDepositLimit = limit;
        mockDepositLimitEnabled = enabled;
        emit DepositLimitUpdated(limit, enabled);
    }

    /**
     * @notice Configure preview functions to revert for valuation testing
     */
    function setPreviewRevertFlags(bool _revertPreviewRedeem, bool _revertConvertToAssets) external {
        require(msg.sender == owner, "Not owner");
        mockRevertOnPreviewRedeem = _revertPreviewRedeem;
        mockRevertOnConvertToAssets = _revertConvertToAssets;
        emit MockBehaviorSet("revertPreviewRedeem", _revertPreviewRedeem);
        emit MockBehaviorSet("revertConvertToAssets", _revertConvertToAssets);
    }

    function _remainingDepositCapacity() internal view returns (uint256) {
        if (!mockDepositLimitEnabled) {
            return type(uint256).max;
        }
        if (mockDepositLimit <= mockTotalAssets) {
            return 0;
        }
        return mockDepositLimit - mockTotalAssets;
    }

    function _enforceDepositLimit(uint256 assetsAfterFee) internal view {
        if (!mockDepositLimitEnabled) {
            return;
        }
        uint256 capacity = _remainingDepositCapacity();
        require(capacity >= assetsAfterFee, "Deposit limit exceeded");
    }

    /**
     * @notice Manually trigger yield accrual for testing
     */
    function accrueYield() public {
        if (block.timestamp > lastYieldUpdate && totalSupply() > 0) {
            uint256 timeElapsed = block.timestamp - lastYieldUpdate;
            uint256 currentAssets = mockTotalAssets;

            // Simple interest calculation for predictable testing
            // yield = principal * rate * time / (365 days * 10000)
            uint256 yield = (currentAssets * yieldRate * timeElapsed) / (365 days * 10000);

            if (yield > 0) {
                mockTotalAssets += yield;
                emit YieldAccrued(yield);
            }

            lastYieldUpdate = block.timestamp;
        }
    }

    /**
     * @notice Simulate a large deposit/withdrawal to test slippage
     */
    function simulateSlippage(int256 assetChange) external {
        if (assetChange > 0) {
            mockTotalAssets += uint256(assetChange);
        } else {
            uint256 decrease = uint256(-assetChange);
            if (decrease >= mockTotalAssets) {
                mockTotalAssets = 0; // Can't go negative
            } else {
                mockTotalAssets -= decrease;
            }
        }
    }

    // --- ERC4626 Overrides ---

    function totalAssets() public view virtual override returns (uint256) {
        // Don't auto-calculate yield - require explicit accrueYield() call for testing
        return mockTotalAssets;
    }

    function maxDeposit(address receiver) public view virtual override returns (uint256) {
        if (mockPaused) {
            return 0;
        }

        uint256 parentLimit = super.maxDeposit(receiver);
        if (!mockDepositLimitEnabled) {
            return parentLimit;
        }

        uint256 remainingCapacity = _remainingDepositCapacity();
        return remainingCapacity < parentLimit ? remainingCapacity : parentLimit;
    }

    function maxMint(address receiver) public view virtual override returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        return convertToShares(maxAssets);
    }

    function maxWithdraw(address owner_) public view virtual override returns (uint256) {
        if (mockPaused) {
            return 0;
        }
        uint256 parentLimit = super.maxWithdraw(owner_);
        if (mockRevertOnConvertToAssets) {
            revert("Preview convert to assets disabled");
        }
        return parentLimit;
    }

    function maxRedeem(address owner_) public view virtual override returns (uint256) {
        if (mockPaused) {
            return 0;
        }
        uint256 parentLimit = super.maxRedeem(owner_);
        if (mockRevertOnPreviewRedeem) {
            revert("Preview redeem disabled");
        }
        return parentLimit;
    }

    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        if (mockRevertOnDeposit) {
            revert("Deposit reverted");
        }
        accrueYield();

        uint256 fee = (assets * mockDepositFee) / 10000;
        uint256 assetsAfterFee = assets - fee;

        _enforceDepositLimit(assetsAfterFee);

        uint256 shares = super.deposit(assetsAfterFee, receiver);
        mockTotalAssets += assetsAfterFee;
        lastDepositTimestamp[receiver] = block.timestamp;

        if (fee > 0) {
            IERC20(asset()).transfer(owner, fee);
        }

        return shares;
    }

    function mint(uint256 shares, address receiver) public virtual override returns (uint256) {
        if (mockRevertOnDeposit) {
            revert("Mint reverted");
        }
        accrueYield();

        uint256 assets = previewMint(shares);
        uint256 fee = (assets * mockDepositFee) / 10000;
        uint256 assetsAfterFee = assets - fee;

        _enforceDepositLimit(assetsAfterFee);

        uint256 actualAssets = super.mint(shares, receiver);
        mockTotalAssets += assetsAfterFee;
        lastDepositTimestamp[receiver] = block.timestamp;

        if (fee > 0) {
            IERC20(asset()).transfer(owner, fee);
        }

        return actualAssets;
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner_
    ) public virtual override returns (uint256 shares) {
        if (mockRevertOnWithdraw) {
            revert("Withdraw reverted");
        }
        accrueYield();

        uint256 fee = (assets * mockWithdrawFee) / 10000;
        uint256 assetsAfterFee = assets - fee;

        shares = super.withdraw(assetsAfterFee, receiver, owner_);
        if (mockTotalAssets >= assetsAfterFee) {
            mockTotalAssets -= assetsAfterFee;
        } else {
            mockTotalAssets = 0;
        }

        if (fee > 0) {
            IERC20(asset()).transfer(owner, fee);
        }
    }

    function redeem(uint256 shares, address receiver, address owner_) public virtual override returns (uint256 assets) {
        if (mockRevertOnWithdraw) {
            revert("Redeem reverted");
        }
        accrueYield();

        assets = super.redeem(shares, receiver, owner_);
        if (mockTotalAssets >= assets) {
            mockTotalAssets -= assets;
        } else {
            mockTotalAssets = 0;
        }
    }

    function previewWithdraw(uint256 assets) public view virtual override returns (uint256) {
        if (mockRevertOnConvertToAssets) {
            revert("Preview convert to assets disabled");
        }
        return super.previewWithdraw(assets);
    }

    function previewRedeem(uint256 shares) public view virtual override returns (uint256) {
        if (mockRevertOnPreviewRedeem) {
            revert("Preview redeem disabled");
        }
        return super.previewRedeem(shares);
    }

    // --- Reward Handling (Mock) ---

    function setRewardToken(address token, uint256 rate) external {
        rewardToken = token;
        rewardRate = rate;
    }

    function accruedRewards(address account) public view returns (uint256) {
        // Simplified reward calculation for testing
        uint256 balance = balanceOf(account);
        if (balance == 0 || rewardRate == 0) {
            return pendingRewards[account];
        }

        uint256 timeElapsed = block.timestamp - lastDepositTimestamp[account];
        uint256 newRewards = (balance * rewardRate * timeElapsed) / 1e18;
        return pendingRewards[account] + newRewards;
    }

    function claimRewards(address account) external returns (uint256) {
        uint256 rewards = accruedRewards(account);
        pendingRewards[account] = 0;
        lastDepositTimestamp[account] = block.timestamp;

        if (rewards > 0) {
            IERC20(rewardToken).transfer(account, rewards);
            emit RewardsClaimed(account, rewards);
        }

        return rewards;
    }

    // --- MetaMorpho Compatibility ---

    function setSkimRecipient(address newSkimRecipient) external {
        require(msg.sender == owner, "Not owner");
        skimRecipient = newSkimRecipient;
    }

    function skim(address token) external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) {
            return;
        }
        IERC20(token).transfer(skimRecipient, balance);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        owner = newOwner;
    }
}
