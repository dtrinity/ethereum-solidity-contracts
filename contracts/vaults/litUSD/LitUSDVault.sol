// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IPriceFeed } from "contracts/oracle_aggregator/interface/chainlink/IPriceFeed.sol";

/**
 * @title LitUSDVault
 * @notice Tracks total reserves during pending LitUSD -> USD redemptions by freezing PoR snapshots.
 */
contract LitUSDVault is AccessControl, ReentrancyGuard, ERC20 {
    using SafeERC20 for IERC20Metadata;

    enum ReserveState {
        NORMAL,
        ADMIN_WITHDRAW_PENDING
    }

    string public constant VAULT_NAME = "Vault LitUSD";
    string public constant VAULT_SYMBOL = "vLitUSD";

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

    IERC20Metadata public immutable litUSD;
    uint8 public immutable litUSDDecimals;

    IPriceFeed public bankPoRFeed;
    uint8 public bankPoRDecimals;

    ReserveState public reserveState;
    uint256 public pendingWithdrawnLitUSD;
    uint256 public frozenBankUSD;
    uint256 public slippageBps;

    event BankPoRFeedSet(address indexed newFeed, uint8 decimals);
    event SlippageBpsSet(uint256 oldBps, uint256 newBps);
    event AdminWithdrawStarted(address indexed receiver, uint256 amount, uint256 frozenBankUSD);
    event AdminWithdrawCompleted(uint256 deltaBankUSD, uint256 pendingAmount);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    error ZeroAddress();
    error ZeroAmount();
    error PendingRedemption();
    error InvalidSlippageBps(uint256 newBps);
    error InvalidBankUSD();
    error InsufficientLiquidity(uint256 available, uint256 required);

    modifier processOracle() {
        _processOracle();
        _;
    }

    constructor(
        address _litUSD,
        address _bankPoRFeed,
        address _admin,
        address _withdrawer
    ) ERC20(VAULT_NAME, VAULT_SYMBOL) {
        if (_litUSD == address(0) || _bankPoRFeed == address(0) || _admin == address(0) || _withdrawer == address(0)) {
            revert ZeroAddress();
        }

        litUSD = IERC20Metadata(_litUSD);
        litUSDDecimals = IERC20Metadata(_litUSD).decimals();

        _setBankPoRFeed(_bankPoRFeed);
        slippageBps = DEFAULT_SLIPPAGE_BPS;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(WITHDRAW_ROLE, _withdrawer);
    }

    /**
     * @notice Returns the share token decimals (matches LitUSD decimals).
     */
    function decimals() public view override returns (uint8) {
        return litUSDDecimals;
    }

    /**
     * @notice Returns the total reserve value in LitUSD decimals.
     */
    function totalReserve() external view returns (uint256 total) {
        uint256 vaultLitUSD = litUSD.balanceOf(address(this));
        if (reserveState == ReserveState.ADMIN_WITHDRAW_PENDING) {
            return vaultLitUSD + pendingWithdrawnLitUSD + frozenBankUSD;
        }

        uint256 bankUSD = _readBankUSD();
        return vaultLitUSD + bankUSD;
    }

    /**
     * @notice Deposit LitUSD and mint vault shares 1:1.
     */
    function deposit(uint256 assets, address receiver) external nonReentrant processOracle returns (uint256 shares) {
        if (receiver == address(0)) revert ZeroAddress();
        if (assets == 0) revert ZeroAmount();

        shares = assets;
        litUSD.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Mint vault shares 1:1 by depositing LitUSD.
     */
    function mint(uint256 shares, address receiver) external nonReentrant processOracle returns (uint256 assets) {
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroAmount();

        assets = shares;
        litUSD.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Burn vault shares and withdraw LitUSD 1:1.
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external nonReentrant processOracle returns (uint256 shares) {
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();
        if (assets == 0) revert ZeroAmount();

        shares = assets;
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        uint256 available = litUSD.balanceOf(address(this));
        if (available < assets) revert InsufficientLiquidity(available, assets);

        _burn(owner, shares);
        litUSD.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Burn vault shares and redeem LitUSD 1:1.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external nonReentrant processOracle returns (uint256 assets) {
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroAmount();

        assets = shares;
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        uint256 available = litUSD.balanceOf(address(this));
        if (available < assets) revert InsufficientLiquidity(available, assets);

        _burn(owner, shares);
        litUSD.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Starts an admin redemption by withdrawing LitUSD and freezing the PoR snapshot.
     */
    function adminWithdrawUnderlying(
        address receiver,
        uint256 amount
    ) external nonReentrant onlyRole(WITHDRAW_ROLE) processOracle {
        if (receiver == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (reserveState != ReserveState.NORMAL) revert PendingRedemption();

        uint256 snapshot = _readBankUSD();
        pendingWithdrawnLitUSD = amount;
        frozenBankUSD = snapshot;
        reserveState = ReserveState.ADMIN_WITHDRAW_PENDING;

        litUSD.safeTransfer(receiver, amount);
        emit AdminWithdrawStarted(receiver, amount, snapshot);
    }

    /**
     * @notice Updates the Chainlink PoR feed.
     */
    function setBankPoRFeed(address newFeed) external onlyRole(DEFAULT_ADMIN_ROLE) processOracle {
        _setBankPoRFeed(newFeed);
    }

    /**
     * @notice Updates the redemption completion slippage threshold in BPS.
     */
    function setSlippageBps(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) processOracle {
        if (newBps > BPS) revert InvalidSlippageBps(newBps);
        uint256 oldBps = slippageBps;
        slippageBps = newBps;
        emit SlippageBpsSet(oldBps, newBps);
    }

    function _processOracle() internal {
        if (reserveState != ReserveState.ADMIN_WITHDRAW_PENDING) return;
        if (pendingWithdrawnLitUSD == 0) {
            _clearPending();
            return;
        }

        (bool ok, uint256 currentBankUSD) = _tryReadBankUSD();
        if (!ok) return;
        if (currentBankUSD <= frozenBankUSD) return;

        uint256 delta = currentBankUSD - frozenBankUSD;
        uint256 minDelta = Math.mulDiv(pendingWithdrawnLitUSD, BPS - slippageBps, BPS);
        if (delta >= minDelta) {
            uint256 pendingAmount = pendingWithdrawnLitUSD;
            _clearPending();
            emit AdminWithdrawCompleted(delta, pendingAmount);
        }
    }

    function _clearPending() internal {
        pendingWithdrawnLitUSD = 0;
        frozenBankUSD = 0;
        reserveState = ReserveState.NORMAL;
    }

    function _setBankPoRFeed(address newFeed) internal {
        if (newFeed == address(0)) revert ZeroAddress();
        bankPoRFeed = IPriceFeed(newFeed);
        bankPoRDecimals = IPriceFeed(newFeed).decimals();
        emit BankPoRFeedSet(newFeed, bankPoRDecimals);
    }

    function _readBankUSD() internal view returns (uint256 value) {
        (bool ok, uint256 bankUSD) = _tryReadBankUSD();
        if (!ok) revert InvalidBankUSD();
        return bankUSD;
    }

    function _tryReadBankUSD() internal view returns (bool ok, uint256 bankUSD) {
        try bankPoRFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            roundId;
            startedAt;
            answeredInRound;
            if (answer <= 0 || updatedAt == 0) return (false, 0);
            uint256 normalized = _convertDecimals(uint256(answer), bankPoRDecimals, litUSDDecimals);
            return (true, normalized);
        } catch {
            return (false, 0);
        }
    }

    function _convertDecimals(uint256 value, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (fromDecimals == toDecimals) return value;
        if (fromDecimals > toDecimals) {
            uint256 divisor = 10 ** uint256(fromDecimals - toDecimals);
            return value / divisor;
        }

        uint256 multiplier = 10 ** uint256(toDecimals - fromDecimals);
        return Math.mulDiv(value, multiplier, 1);
    }
}
