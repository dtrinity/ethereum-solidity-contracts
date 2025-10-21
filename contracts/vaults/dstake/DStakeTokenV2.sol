// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";
import { IDStakeRouterV2 } from "./interfaces/IDStakeRouterV2.sol";
import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { WithdrawalFeeMath } from "../../common/WithdrawalFeeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract DStakeTokenV2 is Initializable, ERC4626Upgradeable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Roles ---
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error ZeroShares();
    error RouterNotSet();
    error RouterOnly();
    error ERC4626ExceedsMaxWithdraw(uint256 assets, uint256 maxAssets);
    error ERC4626ExceedsMaxRedeem(uint256 shares, uint256 maxShares);
    error RouterCollateralMismatch(address router, address expectedVault, address actualVault);
    error RouterTokenMismatch(address router, address expectedToken, address actualToken);

    // --- State ---
    IDStakeCollateralVaultV2 public collateralVault;
    IDStakeRouterV2 public router;

    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = BasisPointConstants.ONE_PERCENT_BPS;

    // --- Events ---
    event RouterSet(address indexed newRouter);
    event CollateralVaultSet(address indexed newCollateralVault);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 _dStable,
        string memory _name,
        string memory _symbol,
        address _initialAdmin,
        address _initialFeeManager
    ) public initializer {
        __ERC20_init(_name, _symbol);
        __ERC4626_init(_dStable);
        __AccessControl_init();

        if (address(_dStable) == address(0) || _initialAdmin == address(0) || _initialFeeManager == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(FEE_MANAGER_ROLE, _initialFeeManager);
    }

    // --- Fee helpers ---
    function withdrawalFeeBps() public view returns (uint256) {
        if (address(router) == address(0)) {
            return 0;
        }
        return router.withdrawalFeeBps();
    }

    function maxWithdrawalFeeBps() public pure returns (uint256) {
        return MAX_WITHDRAWAL_FEE_BPS;
    }

    function getWithdrawalFeeBps() public view returns (uint256) {
        return withdrawalFeeBps();
    }

    function _calculateWithdrawalFee(uint256 grossAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.calculateWithdrawalFee(grossAmount, withdrawalFeeBps());
    }

    function _getNetAmountAfterFee(uint256 grossAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.netAfterFee(grossAmount, withdrawalFeeBps());
    }

    function _getGrossAmountRequiredForNet(uint256 netAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.grossFromNet(netAmount, withdrawalFeeBps());
    }

    // --- Accounting ---
    function totalAssets() public view virtual override returns (uint256) {
        uint256 grossAssets = _grossTotalAssets();
        if (grossAssets == 0) {
            return 0;
        }

        uint256 shortfall = address(router) == address(0) ? 0 : router.currentShortfall();
        return shortfall >= grossAssets ? 0 : grossAssets - shortfall;
    }

    function _grossTotalAssets() internal view returns (uint256) {
        if (address(router) == address(0)) {
            return 0;
        }
        return router.totalManagedAssets();
    }

    function grossTotalAssets() public view returns (uint256) {
        return _grossTotalAssets();
    }

    function _convertToSharesUsingNet(uint256 assets, Math.Rounding rounding) internal view returns (uint256) {
        if (assets == 0) {
            return 0;
        }

        uint256 supply = totalSupply() + 10 ** _decimalsOffset();
        uint256 netAssets = totalAssets();
        return Math.mulDiv(assets, supply, netAssets + 1, rounding);
    }

    function _convertToAssetsUsingNet(uint256 shares, Math.Rounding rounding) internal view returns (uint256) {
        if (shares == 0) {
            return 0;
        }

        uint256 supply = totalSupply() + 10 ** _decimalsOffset();
        uint256 netAssets = totalAssets();
        return Math.mulDiv(shares, netAssets + 1, supply, rounding);
    }

    function convertToShares(uint256 assets) public view virtual override returns (uint256) {
        return previewDeposit(assets);
    }

    function convertToAssets(uint256 shares) public view virtual override returns (uint256) {
        return _convertToAssetsUsingNet(shares, Math.Rounding.Floor);
    }

    function previewDeposit(uint256 assets) public view virtual override returns (uint256) {
        return _convertToSharesUsingNet(assets, Math.Rounding.Floor);
    }

    function previewMint(uint256 shares) public view virtual override returns (uint256) {
        return _convertToAssetsUsingNet(shares, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view virtual override returns (uint256) {
        uint256 grossAssetsRequired = _getGrossAmountRequiredForNet(assets);
        return super.previewWithdraw(grossAssetsRequired);
    }

    function previewRedeem(uint256 shares) public view virtual override returns (uint256) {
        uint256 grossAssets = super.previewRedeem(shares);
        return _getNetAmountAfterFee(grossAssets);
    }

    // --- Limits ---
    function maxDeposit(address receiver) public view virtual override returns (uint256) {
        if (address(router) == address(0)) {
            return 0;
        }
        try router.maxDeposit(receiver) returns (uint256 limit) {
            return limit;
        } catch {
            return 0;
        }
    }

    function maxMint(address receiver) public view virtual override returns (uint256) {
        if (address(router) == address(0)) {
            return 0;
        }
        try router.maxMint(receiver) returns (uint256 limit) {
            return limit;
        } catch {
            return 0;
        }
    }

    function maxWithdraw(address owner) public view virtual override returns (uint256) {
        if (address(router) == address(0)) {
            uint256 grossAssets = convertToAssets(balanceOf(owner));
            return _getNetAmountAfterFee(grossAssets);
        }
        try router.maxWithdraw(owner) returns (uint256 limit) {
            return limit;
        } catch {
            return 0;
        }
    }

    function maxRedeem(address owner) public view virtual override returns (uint256) {
        if (address(router) == address(0)) {
            return balanceOf(owner);
        }
        try router.maxRedeem(owner) returns (uint256 limit) {
            return limit;
        } catch {
            return 0;
        }
    }

    // --- ERC4626 core overrides ---
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        if (shares == 0) {
            revert ZeroShares();
        }
        if (address(router) == address(0)) {
            revert RouterNotSet();
        }

        super._deposit(caller, receiver, assets, shares);

        IERC20(asset()).forceApprove(address(router), assets);
        router.handleDeposit(caller, assets, shares, receiver);
        IERC20(asset()).forceApprove(address(router), 0);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256 shares) {
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) {
            revert ERC4626ExceedsMaxWithdraw(assets, maxAssets);
        }

        shares = previewWithdraw(assets);
        if (shares == 0 && assets > 0) {
            revert ZeroShares();
        }

        uint256 maxRedeemShares = maxRedeem(owner);
        if (shares > maxRedeemShares) {
            revert ERC4626ExceedsMaxRedeem(shares, maxRedeemShares);
        }

        uint256 grossAssets = _getGrossAmountRequiredForNet(assets);
        _withdraw(_msgSender(), receiver, owner, grossAssets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256 assets) {
        uint256 maxRedeemShares = maxRedeem(owner);
        if (shares > maxRedeemShares) {
            revert ERC4626ExceedsMaxRedeem(shares, maxRedeemShares);
        }

        uint256 grossAssets = super.previewRedeem(shares);
        assets = _getNetAmountAfterFee(grossAssets);
        _withdraw(_msgSender(), receiver, owner, grossAssets, shares);
        return assets;
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        if (assets == 0 || shares == 0) {
            if (shares > 0) {
                _burn(owner, shares);
            }
            emit Withdraw(caller, receiver, owner, 0, shares);
            return;
        }

        if (address(router) == address(0)) {
            revert RouterNotSet();
        }

        _burn(owner, shares);

        uint256 expectedNet = _getNetAmountAfterFee(assets);
        (uint256 netAssets, ) = router.handleWithdraw(caller, receiver, owner, assets, expectedNet);

        emit Withdraw(caller, receiver, owner, netAssets, shares);
    }

    // --- Fee management proxies ---
    function reinvestFees() external returns (uint256 amountReinvested) {
        if (address(router) == address(0)) {
            revert RouterNotSet();
        }

        (uint256 amount, uint256 incentive) = router.reinvestFees();
        if (incentive > 0) {
            IERC20(asset()).safeTransfer(_msgSender(), incentive);
        }

        return amount;
    }

    function setWithdrawalFee(uint256 feeBps) external onlyRole(FEE_MANAGER_ROLE) {
        if (address(router) == address(0)) {
            revert RouterNotSet();
        }
        router.setWithdrawalFee(feeBps);
    }

    function setReinvestIncentive(uint256 incentiveBps) external onlyRole(FEE_MANAGER_ROLE) {
        if (address(router) == address(0)) {
            revert RouterNotSet();
        }
        router.setReinvestIncentive(incentiveBps);
    }

    function setSettlementShortfall(uint256 newShortfall) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(router) == address(0)) {
            revert RouterNotSet();
        }

        uint256 current = router.currentShortfall();
        if (newShortfall >= current) {
            router.recordShortfall(newShortfall - current);
        } else {
            router.clearShortfall(current - newShortfall);
        }
    }

    // --- Administration ---
    function migrateCore(address newRouter, address newCollateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRouter == address(0) || newCollateralVault == address(0)) {
            revert ZeroAddress();
        }

        IDStakeRouterV2 routerCandidate = IDStakeRouterV2(newRouter);
        if (routerCandidate.collateralVault() != IDStakeCollateralVaultV2(newCollateralVault)) {
            revert RouterCollateralMismatch(newRouter, newCollateralVault, address(routerCandidate.collateralVault()));
        }

        if (routerCandidate.dStakeToken() != address(this)) {
            revert RouterTokenMismatch(newRouter, address(this), routerCandidate.dStakeToken());
        }

        router = routerCandidate;
        collateralVault = IDStakeCollateralVaultV2(newCollateralVault);

        emit RouterSet(newRouter);
        emit CollateralVaultSet(newCollateralVault);
    }

    // --- Router hooks ---
    function mintForRouter(address initiator, address receiver, uint256 assets, uint256 shares) external {
        if (_msgSender() != address(router)) {
            revert RouterOnly();
        }
        if (shares == 0) {
            revert ZeroShares();
        }
        _mint(receiver, shares);
        emit Deposit(initiator, receiver, assets, shares);
    }

    function burnFromRouter(
        address initiator,
        address receiver,
        address owner,
        uint256 netAssets,
        uint256 shares
    ) external {
        if (_msgSender() != address(router)) {
            revert RouterOnly();
        }
        if (shares == 0) {
            revert ZeroShares();
        }
        if (initiator != owner) {
            _spendAllowance(owner, initiator, shares);
        }
        _burn(owner, shares);
        emit Withdraw(initiator, receiver, owner, netAssets, shares);
    }
}
