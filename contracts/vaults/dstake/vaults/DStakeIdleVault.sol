// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DStakeIdleVault
 * @notice Minimal ERC4626 vault that holds idle dUSD and streams fixed-rate emissions to depositors.
 * @dev Emission tokens must be pre-funded via `fundRewards`. Pending emissions accrue linearly over
 *      `emissionPerSecond` between `emissionStart` and `emissionEnd` and are released to depositors on
 *      interaction or explicit `accrueRewards` calls. Reserves that are not yet released are excluded
 *      from the ERC4626 accounting so they do not dilute share pricing before they vest.
 */
contract DStakeIdleVault is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Roles ---
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error InvalidEmissionWindow();
    error InsufficientRewardReserve();

    // --- Events ---
    event EmissionScheduleSet(uint64 indexed start, uint64 indexed end, uint256 emissionPerSecond);
    event RewardsFunded(address indexed sender, uint256 amount);
    event RewardsWithdrawn(address indexed receiver, uint256 amount);
    event RewardsAccrued(uint256 amountReleased);

    // --- State ---
    uint64 public emissionStart; // Timestamp when emissions begin (inclusive)
    uint64 public emissionEnd; // Timestamp when emissions end (exclusive)
    uint64 public lastEmissionUpdate; // Last timestamp emissions were accounted
    uint256 public emissionPerSecond; // Amount of dUSD released per second
    uint256 public rewardReserve; // Portion of assets reserved for future emissions

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin,
        address rewardManager
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (address(asset_) == address(0) || admin == address(0) || rewardManager == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARD_MANAGER_ROLE, rewardManager);
        lastEmissionUpdate = uint64(block.timestamp);
    }

    // --- ERC4626 overrides ---
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        _accrue();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        _accrue();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override nonReentrant returns (uint256) {
        _accrue();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256) {
        _accrue();
        return super.redeem(shares, receiver, owner);
    }

    /// @notice Total assets backing vault shares, accounting for vested emissions.
    function totalAssets() public view override returns (uint256) {
        uint256 rawAssets = IERC20(asset()).balanceOf(address(this));
        uint256 pending = _pendingEmission();
        if (rawAssets < rewardReserve) {
            return pending; // Should not happen, but prevents underflow.
        }
        return rawAssets - rewardReserve + pending;
    }

    // --- Reward Management ---

    /// @notice Pre-fund the vault with dUSD that will be streamed to depositors over time.
    /// @dev Caller must approve `amount` before invoking. Accrues existing emissions first to preserve ordering.
    function fundRewards(uint256 amount) external onlyRole(REWARD_MANAGER_ROLE) {
        if (amount == 0) {
            return;
        }
        _accrue();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    /// @notice Withdraw unreleased reward reserves back to the reward manager.
    function withdrawUnreleasedRewards(address to, uint256 amount) external onlyRole(REWARD_MANAGER_ROLE) {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        _accrue();
        if (amount > rewardReserve) {
            revert InsufficientRewardReserve();
        }
        rewardReserve -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit RewardsWithdrawn(to, amount);
    }

    /// @notice Configure the emission schedule for streaming rewards.
    /// @param start Timestamp when emissions start (inclusive)
    /// @param end Timestamp when emissions end (exclusive)
    /// @param rate Emission rate in dUSD per second
    function setEmissionSchedule(uint64 start, uint64 end, uint256 rate) external onlyRole(REWARD_MANAGER_ROLE) {
        if (end != 0 && end <= start) {
            revert InvalidEmissionWindow();
        }
        _accrue();

        emissionStart = start;
        emissionEnd = end;
        emissionPerSecond = rate;
        lastEmissionUpdate = uint64(block.timestamp);

        emit EmissionScheduleSet(start, end, rate);
    }

    /// @notice Manually accrue any pending emissions into the vault shares.
    /// @return amountReleased Amount of dUSD moved from the reward reserve into active assets.
    function accrueRewards() external returns (uint256 amountReleased) {
        amountReleased = _accrue();
        emit RewardsAccrued(amountReleased);
    }

    /// @notice Amount of rewards that have vested but not yet been accounted for.
    function pendingEmission() external view returns (uint256) {
        return _pendingEmission();
    }

    /// @notice Remaining reserves earmarked for future emissions (excludes pending amount).
    function remainingRewardReserve() external view returns (uint256) {
        uint256 pending = _pendingEmission();
        if (pending >= rewardReserve) {
            return 0;
        }
        return rewardReserve - pending;
    }

    // --- Internal helpers ---

    function _accrue() internal returns (uint256 released) {
        // NOTE: Known limitation – when totalSupply() is zero accrued rewards are released into
        // the vault and remain claimable by the next depositor. Operationally we rely on the vault
        // maintaining a non-zero supply or keeping reward funding paused during idle periods.
        released = _pendingEmission();
        if (released == 0) {
            lastEmissionUpdate = uint64(block.timestamp);
            return 0;
        }
        rewardReserve -= released;
        lastEmissionUpdate = uint64(block.timestamp);
    }

    function _pendingEmission() internal view returns (uint256) {
        uint64 currentTime = uint64(block.timestamp);
        uint64 lastUpdate = lastEmissionUpdate;

        if (currentTime <= lastUpdate) {
            return 0;
        }

        uint64 start = emissionStart;
        uint64 end = emissionEnd;
        if (end != 0 && lastUpdate >= end) {
            return 0;
        }

        uint64 effectiveStart = start > lastUpdate ? start : lastUpdate;
        if (end != 0 && end < currentTime) {
            currentTime = end;
        }

        if (currentTime <= effectiveStart) {
            return 0;
        }

        uint256 elapsed = uint256(currentTime - effectiveStart);
        uint256 accrued = elapsed * emissionPerSecond;
        if (accrued > rewardReserve) {
            return rewardReserve;
        }
        return accrued;
    }
}
