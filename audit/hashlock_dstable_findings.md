# Security Audit Report - dStable Folder

**Audit Date:** November 5, 2025
**Auditor:** HASHLOCK Audit Team
**Scope:** dStable Protocol Contracts (`contracts/dstable/`)

---

**Summary of Findings:**
- Critical: 0
- High: 0
- Medium: 0
- Low: 3
- Informational: 4

---

## Findings Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| L-01 | Missing Role Revocation Protection | Low | Open |
| L-02 | Missing Constructor Input Validation | Low | Open |
| L-03 | Permit Front-Running in Admin Function | Low | Open |
| I-01 | Missing Zero Address Check in setCollateralVault | Informational | Open |
| I-02 | Gas Optimization in setFeeReceiver | Informational | Open |
| I-03 | Redundant AccessControl Inheritance | Informational | Open |
| I-04 | Missing Bounds Check in setTolerance | Informational | Open |

---

## Detailed Findings

---

### L-01: Missing Role Revocation Protection

**Title:** Admin Role Can Be Permanently Removed Leading to Ownerless Contract

**Location:**
- File: `IssuerV2_1.sol` (Line 36)
- File: `RedeemerV2.sol` (Similar pattern)

**Description:**
The IssuerV2_1 and RedeemerV2 contracts inherit from OpenZeppelin's AccessControl without overriding the `revokeRole()` and `renounceRole()` functions. This allows the DEFAULT_ADMIN_ROLE to be permanently removed, either accidentally or maliciously, rendering the contract ownerless and preventing any future administrative actions.

**Vulnerability Details:**
The AccessControl implementation allows any role holder to renounce their role, and admins can revoke roles from any address. If the last holder of DEFAULT_ADMIN_ROLE either renounces it or has it revoked, the contract becomes permanently ownerless. This is particularly dangerous because DEFAULT_ADMIN_ROLE controls critical functions such as setting the collateral vault, managing fees, pausing/unpausing operations, and granting other roles. Once the admin role is lost, these functions become permanently inaccessible, and the contract cannot adapt to changing conditions or emergencies. While this might be intentional in some protocols to create truly immutable contracts, the presence of admin-only functions suggests this is not the intended design for dStable.

**Impact:**
If the DEFAULT_ADMIN_ROLE is accidentally or maliciously removed, the protocol loses all administrative control. Critical functions like `setCollateralVault()`, `setAssetMintingPause()`, `pauseMinting()`, and role management become permanently inaccessible. This could leave the protocol unable to respond to security incidents, upgrade vulnerabilities, or adapt to changing market conditions. In RedeemerV2, this would also prevent updating fee parameters, which could result in users being locked into unfavorable fee structures. The protocol would essentially become frozen in its current state, unable to evolve or respond to emergencies, potentially leading to user fund loss if critical parameters need adjustment.

**Recommendation:**
Implement protective overrides for `revokeRole()` and `renounceRole()` to prevent the last DEFAULT_ADMIN_ROLE holder from being removed. The recommended implementation should check if the role being revoked is DEFAULT_ADMIN_ROLE and ensure at least one admin remains after the operation. Additionally, consider implementing a two-step admin transfer process similar to Ownable2Step, where a new admin must accept the role before the old admin can renounce it. This pattern provides additional safety against accidental role loss.

**Recommended Code Fix:**

```solidity
// IssuerV2_1.sol and RedeemerV2.sol

/**
 * @dev Override to prevent removing the last admin
 */
function revokeRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
    if (role == DEFAULT_ADMIN_ROLE) {
        // Ensure at least one admin will remain
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) > 1, "Cannot remove last admin");
    }
    super.revokeRole(role, account);
}

/**
 * @dev Override to prevent the last admin from renouncing
 */
function renounceRole(bytes32 role, address account) public virtual override {
    if (role == DEFAULT_ADMIN_ROLE) {
        // Ensure at least one admin will remain
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) > 1, "Cannot renounce last admin");
    }
    super.renounceRole(role, account);
}

// Alternative: Implement two-step transfer (recommended)
address private _pendingAdmin;

function transferAdmin(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(newAdmin != address(0), "Invalid admin address");
    _pendingAdmin = newAdmin;
}

function acceptAdmin() external {
    require(msg.sender == _pendingAdmin, "Not pending admin");
    _grantRole(DEFAULT_ADMIN_ROLE, _pendingAdmin);
    _pendingAdmin = address(0);
}
```

---

### L-02: Missing Constructor Input Validation

**Title:** IssuerV2_1 Constructor Lacks Input Validation Leading to Deployment Issues

**Location:**
- File: `IssuerV2_1.sol` (Line 76)
- Function: `constructor()`

**Description:**
The IssuerV2_1 constructor does not validate input parameters for zero addresses, unlike the RedeemerV2 contract which implements comprehensive validation. This inconsistency in validation patterns across similar contracts can lead to deployment failures or contracts being deployed in an unusable state.

**Vulnerability Details:**
The constructor accepts three critical parameters: `_collateralVault`, `_dstable`, and `oracle`. If any of these parameters is set to the zero address (0x0), the contract will be deployed but will be completely non-functional. For comparison, RedeemerV2's constructor includes explicit checks: `if (_collateralVault == address(0) || _dstable == address(0) || address(_oracle) == address(0)) { revert CannotBeZeroAddress(); }`. Without these checks in IssuerV2_1, several issues arise. First, calling `dstable.decimals()` on line 79 would revert if dstable is address(0), causing deployment to fail after gas has been consumed. Second, if deployment somehow succeeds (due to specific EVM conditions), the contract would be permanently broken since these are immutable/critical state variables. Third, this creates an inconsistent security model across the protocol, where developers might assume validation exists based on patterns in other contracts.

**Impact:**
If the constructor is called with zero address for any parameter, the deployment transaction will revert after consuming gas, resulting in wasted deployment costs. In a worst-case scenario where the deployment appears to succeed but the contract is non-functional, any tokens or permissions granted to this contract would be effectively locked, as the contract cannot perform its intended operations. Additionally, this inconsistency with RedeemerV2's validation pattern creates confusion for developers and auditors, potentially leading to deployment script errors or integration issues. The lack of validation also makes it harder to debug deployment failures, as the error would come from `dstable.decimals()` rather than a clear validation error.

**Recommendation:**
Add explicit zero-address validation in the IssuerV2_1 constructor to match the pattern used in RedeemerV2. This ensures consistency across the protocol and provides clear, actionable error messages when deployment parameters are incorrect. The validation should occur before any state variables are set or external calls are made to minimize gas waste on failed deployments.

**Recommended Code Fix:**

```solidity
// IssuerV2_1.sol

constructor(
    address _collateralVault,
    address _dstable,
    IPriceOracleGetter oracle
) OracleAware(oracle, oracle.BASE_CURRENCY_UNIT()) {
    // Add validation consistent with RedeemerV2
    if (_collateralVault == address(0) || _dstable == address(0) || address(oracle) == address(0)) {
        revert CannotBeZeroAddress();
    }

    collateralVault = CollateralVault(_collateralVault);
    dstable = IMintableERC20(_dstable);
    dstableDecimals = dstable.decimals();

    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    grantRole(INCENTIVES_MANAGER_ROLE, msg.sender);
    grantRole(PAUSER_ROLE, msg.sender);
}

// Add error definition if not already present
error CannotBeZeroAddress();
```

---

### L-03: Permit Front-Running in Admin Function

**Title:** repayWithPermit Front-Running Has Minimal Impact Due to Privileged Access

**Location:**
- File: `AmoManagerV2.sol` (Line 344)
- Function: `repayWithPermit()`

**Description:**
The `repayWithPermit()` function is susceptible to permit signature front-running, but the impact is minimal because this function is restricted to the privileged AMO_DECREASE_ROLE and not accessible to regular users.

**Vulnerability Details:**
The EIP-2612 permit mechanism allows signatures to be observed in the mempool and potentially front-run. When `repayWithPermit()` is called, an observer could extract the permit parameters (v, r, s) and submit them in a separate transaction with higher gas. However, this function is only callable by AMO_DECREASE_ROLE, which is typically an admin or automated bot. The "attack" actually benefits the protocol because the front-runner pays gas to execute the permit, granting approval for free. If the original transaction fails due to the consumed permit, the admin can simply retry using the regular `repayFrom()` function, which will now work since the approval was already granted by the front-runner. This is fundamentally different from user-facing permit functions where front-running causes genuine user experience issues.

**Impact:**
The impact is negligible because this is an admin-only function. If front-run, the "attacker" essentially pays gas to help the protocol by granting the approval, allowing the admin to complete the repayment with just `repayFrom()` at a lower gas cost. The worst-case scenario is a failed transaction and immediate retry, which is an acceptable operational inconvenience for privileged roles. There is no loss of funds, no permanent denial of service, and no user experience degradation since regular users cannot call this function. The admin/bot operator is sophisticated enough to handle transaction failures and retries. In fact, the front-running could be viewed as beneficial since it reduces the protocol's overall gas costs.

**Recommendation:**
Document this behavior in the function's NatSpec comments to inform operators that permit front-running may occur but is not a security concern. Optionally, implement a try-catch pattern around the permit call to gracefully handle cases where the permit has already been consumed, allowing the function to proceed if approval already exists. However, given the minimal impact and admin-only access, this is a low-priority optimization rather than a security fix.

**Recommended Code Fix:**

```solidity
// AmoManagerV2.sol

/**
 * @notice Repay using EIP-2612 permit for collateral tokens that support it
 * @dev This function is restricted to AMO_DECREASE_ROLE (admin/bot).
 *      Note: Permit signatures can be front-run, but this only results in
 *      the approval being granted earlier. If this occurs, simply retry
 *      with repayFrom() which will work since approval is already set.
 */
function repayWithPermit(
    address wallet,
    address asset,
    uint256 amount,
    uint256 maxDebtBurned,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external onlyRole(AMO_DECREASE_ROLE) nonReentrant {
    // Optional: Try-catch to handle permit failures gracefully
    try IERC20Permit(asset).permit(wallet, address(this), amount, deadline, v, r, s) {
        // Permit successful
    } catch {
        // Permit may have been front-run or already executed
        // Verify approval exists before proceeding
        require(
            IERC20Metadata(asset).allowance(wallet, address(this)) >= amount,
            "Insufficient allowance"
        );
    }

    repayFrom(wallet, asset, amount, maxDebtBurned);
}
```

---

### I-01: Missing Zero Address Check in setCollateralVault

**Title:** setCollateralVault Allows Setting Zero Address Breaking Core Functionality

**Location:**
- File: `IssuerV2_1.sol` (Line 181)
- Function: `setCollateralVault()`

**Description:**
The `setCollateralVault()` function allows the admin to update the collateral vault address but does not validate against the zero address (0x0), which could break core contract functionality if set incorrectly.

**Vulnerability Details:**
Unlike the constructor validation in RedeemerV2 which checks for zero addresses, the `setCollateralVault()` function in IssuerV2_1 directly assigns the new address without validation: `collateralVault = CollateralVault(_collateralVault);`. If an admin accidentally or maliciously calls this function with `address(0)`, all subsequent operations that depend on the collateral vault would fail. Specifically, the `issue()` function calls `collateralVault.isCollateralSupported()` and `safeTransferFrom()` to the vault address, both of which would revert. The `collateralInDstable()` function calls `collateralVault.totalValue()` which would also revert. While this is an admin-only function and presumably the admin would notice the issue quickly, the window between setting a zero address and correcting it could prevent all minting operations and cause operational disruptions. Additionally, because collateralVault is a state variable used throughout the contract, setting it to address(0) effectively bricks the contract until an admin corrects it.

**Impact:**
Setting the collateral vault to address(0) would cause all core functionalities to fail. Users attempting to call `issue()` would experience transaction reverts, effectively pausing all minting operations until the admin corrects the mistake. The `issueUsingExcessCollateral()` function would also fail as it relies on `collateralInDstable()`. While this is not a permanent issue since the admin can call `setCollateralVault()` again with the correct address, the operational disruption could be significant if it occurs during high-traffic periods. User confidence in the protocol could be damaged if minting operations unexpectedly fail, and the protocol could miss arbitrage or market-making opportunities during the downtime. The lack of validation also indicates a gap in defensive programming practices that could extend to other admin functions.

**Recommendation:**
Add a zero-address validation check in the `setCollateralVault()` function to prevent accidental misconfiguration. This defensive check aligns with similar validation patterns used throughout the protocol and provides an additional safety layer for critical administrative operations. The validation should revert with a clear error message to help admins understand what went wrong.

**Recommended Code Fix:**

```solidity
// IssuerV2_1.sol

/**
 * @notice Sets the collateral vault address
 * @param _collateralVault The address of the collateral vault
 */
function setCollateralVault(address _collateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
    // Add validation to prevent zero address
    if (_collateralVault == address(0)) {
        revert CannotBeZeroAddress();
    }

    collateralVault = CollateralVault(_collateralVault);
    emit CollateralVaultSet(_collateralVault);
}

// Add error definition if not already present
error CannotBeZeroAddress();
```

---

### I-02: Gas Optimization in setFeeReceiver

**Title:** Redundant State Write in setFeeReceiver Wastes Gas

**Location:**
- File: `RedeemerV2.sol` (Line 245)
- Function: `setFeeReceiver()`

**Description:**
The `setFeeReceiver()` function does not check if the new fee receiver is different from the current one, leading to unnecessary state writes and wasted gas when called with the same address.

**Vulnerability Details:**
The current implementation of `setFeeReceiver()` only validates that the new address is not zero, but does not check if it's different from the current `feeReceiver`. This means an admin could accidentally call this function with the same address that's already set, resulting in a state write operation (SSTORE) that doesn't change any state. SSTORE is one of the most expensive EVM operations, costing 20,000 gas for writing to a new slot or 5,000 gas for updating an existing slot. The function also emits an event even when no actual change occurs, which adds unnecessary data to the blockchain and makes it harder to track meaningful changes in the event logs. While this doesn't present a security risk, it violates the principle of gas efficiency and can accumulate unnecessary costs over many admin operations.

**Impact:**
The gas impact is relatively minor since this is an admin function that is called infrequently. However, every unnecessary state write wastes approximately 5,000 gas, and emitting redundant events clutters the event logs and makes it harder for off-chain systems to track meaningful state changes. If the admin accidentally calls this function multiple times with the same address, each call wastes gas without providing any value. Additionally, redundant events could confuse monitoring systems that track fee receiver changes, potentially triggering false alerts or obscuring actual changes in the event history. While this is classified as Informational due to its low impact, implementing the check aligns with gas optimization best practices and improves the overall quality of the codebase.

**Recommendation:**
Add a check to verify that the new fee receiver is different from the current one before executing the state change and emitting the event. This simple validation prevents unnecessary gas expenditure and ensures that events are only emitted when meaningful state changes occur. The check should be performed after the zero-address validation to maintain the existing security properties.

**Recommended Code Fix:**

```solidity
// RedeemerV2.sol

function setFeeReceiver(address _newFeeReceiver) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (_newFeeReceiver == address(0)) {
        revert CannotBeZeroAddress();
    }

    // Add check to prevent unnecessary state write
    if (_newFeeReceiver == feeReceiver) {
        return; // Or revert with custom error: revert FeeReceiverUnchanged();
    }

    address oldFeeReceiver = feeReceiver;
    feeReceiver = _newFeeReceiver;

    emit FeeReceiverUpdated(oldFeeReceiver, _newFeeReceiver);
}

// Optional: Add custom error for clarity
error FeeReceiverUnchanged();
```

---

### I-03: Redundant AccessControl Inheritance

**Title:** Duplicate AccessControl Inheritance Through OracleAware

**Location:**
- File: `IssuerV2_1.sol` (Line 36)
- File: `RedeemerV2.sol` (Similar pattern)

**Description:**
The IssuerV2_1 and RedeemerV2 contracts inherit from AccessControl both directly and indirectly through the OracleAware abstract contract, creating redundant inheritance that could be simplified.

**Vulnerability Details:**
Both IssuerV2_1 and RedeemerV2 explicitly inherit from AccessControl in their contract declarations (`contract IssuerV2_1 is AccessControl, OracleAware, ReentrancyGuard, Pausable`), while also inheriting from OracleAware which itself inherits from AccessControl (`abstract contract OracleAware is AccessControl`). Due to Solidity's C3 linearization algorithm for multiple inheritance, only a single instance of AccessControl is used in the final contract, making the direct inheritance redundant. While Solidity handles this correctly and there is no functional impact, this pattern creates unnecessary code verbosity and potential confusion for developers and auditors. The inheritance chain becomes: IssuerV2_1 → AccessControl (direct) → OracleAware → AccessControl (indirect), where the C3 linearization resolves this to a single AccessControl instance. However, the explicit mention of AccessControl in the contract declaration suggests that either the developers were unaware of the indirect inheritance, or the direct inheritance is truly redundant and can be removed. This redundancy also appears in multiple contracts across the codebase, indicating a potential pattern that should be addressed for consistency.

**Impact:**
The redundant inheritance has no functional impact on the contract's security or behavior due to Solidity's inheritance resolution mechanism. However, it creates unnecessary code complexity and can lead to developer confusion about which inheritance path is being used for AccessControl functions. When reviewing or modifying the contracts, developers might wonder why AccessControl is inherited twice and whether there's a specific reason for the explicit inheritance. This could lead to hesitation when making changes or concerns about breaking existing functionality. Additionally, from a code quality and maintainability perspective, redundant declarations make the codebase harder to understand and maintain. New developers onboarding to the project might spend time trying to understand why the double inheritance exists, and code reviewers must verify that the redundancy is intentional or accidental. While the Solidity compiler handles this gracefully, cleaner inheritance hierarchies improve code readability and reduce the cognitive load required to understand the contract structure.

**Recommendation:**
Remove the direct AccessControl inheritance from IssuerV2_1 and RedeemerV2 since it is already inherited through OracleAware. This simplifies the inheritance hierarchy and makes it clearer that AccessControl functionality comes from the OracleAware base contract. The change is purely cosmetic and does not affect the compiled bytecode or functionality, but it improves code clarity and maintainability. Ensure that after removing the direct inheritance, all AccessControl functionality continues to work as expected, though this should be the case due to the indirect inheritance through OracleAware. Consider adding a comment explaining that AccessControl is inherited through OracleAware to make the inheritance chain explicit for future developers.

**Recommended Code Fix:**

```solidity
// IssuerV2_1.sol - BEFORE
contract IssuerV2_1 is AccessControl, OracleAware, ReentrancyGuard, Pausable {
    // ... contract code ...
}

// IssuerV2_1.sol - AFTER
/**
 * @dev Inherits AccessControl through OracleAware
 */
contract IssuerV2_1 is OracleAware, ReentrancyGuard, Pausable {
    // ... contract code ...
}

// RedeemerV2.sol - BEFORE
contract RedeemerV2 is AccessControl, OracleAware, ReentrancyGuard, Pausable {
    // ... contract code ...
}

// RedeemerV2.sol - AFTER
/**
 * @dev Inherits AccessControl through OracleAware
 */
contract RedeemerV2 is OracleAware, ReentrancyGuard, Pausable {
    // ... contract code ...
}
```

**Note:** After making this change, verify that all role-based access control functions (`onlyRole`, `grantRole`, `revokeRole`, etc.) continue to function correctly. The functionality should remain identical as the AccessControl implementation is still inherited through OracleAware, but testing is recommended to confirm no unexpected issues arise from the change in inheritance order.

---

### I-04: Missing Bounds Check in setTolerance

**Title:** Unbounded Tolerance Parameter May Cause Operational Issues

**Location:**
- File: `AmoManagerV2.sol` (Line 407)
- Function: `setTolerance()`

**Description:**
The `setTolerance()` function allows the admin to set the tolerance parameter to any value without bounds checking, which could inadvertently cause all AMO operations to fail if set too low or compromise invariant protection if set too high.

**Vulnerability Details:**
The tolerance parameter is critical to the functioning of all AMO operations in AmoManagerV2. It is used in invariant checks for `increaseAmoSupply()`, `decreaseAmoSupply()`, `borrowTo()`, and `repayFrom()` to allow for minimal rounding differences. The function `setTolerance()` currently has no validation: `tolerance = newTolerance;`. If an admin accidentally sets this to zero or an extremely low value, the invariant checks become too strict. For example, the check `if (actualDebtIncrease + tolerance < expectedDebtFromDstable || actualDebtIncrease > expectedDebtFromDstable + tolerance)` would revert even for legitimate 1-wei rounding differences. Conversely, if set too high (e.g., due to a decimal error like setting 1e18 instead of 1), the invariant checks become meaningless and could allow value leakage from the vault. The constructor sets `tolerance = 1` as a sensible default (1 wei), but there's no enforcement of reasonable bounds when updating it.

**Impact:**
Setting tolerance to zero would effectively brick all AMO operations since any tiny rounding difference would trigger `InvariantViolation` reverts. This would prevent the protocol from executing any AMO increase/decrease or borrow/repay operations until the admin corrects the tolerance value. While this is recoverable by calling `setTolerance()` again with a proper value, the operational disruption could be significant during high-traffic periods or time-sensitive market conditions. Conversely, setting an excessively high tolerance (e.g., 1e18 due to a typo) could allow substantial value discrepancies to pass the invariant checks, potentially enabling value leakage from the vault. However, since this is an admin-only function and the admin is expected to be trusted and competent, the likelihood of this occurring is relatively low.

**Recommendation:**
Add reasonable bounds checking to the `setTolerance()` function to prevent both accidentally setting it too low (which would break operations) and too high (which would weaken invariant protection). A sensible maximum could be based on a small percentage of baseCurrencyUnit (e.g., 0.01% = baseCurrencyUnit / 10000) to allow for genuine rounding while preventing large discrepancies. Consider also emitting a warning event or requiring two-step confirmation if tolerance is changed by more than an order of magnitude from its current value.

**Recommended Code Fix:**

```solidity
// AmoManagerV2.sol

/**
 * @notice Sets the tolerance for invariant checks
 * @param newTolerance The new tolerance value in base units
 * @dev Only callable by DEFAULT_ADMIN_ROLE
 *      Tolerance must be non-zero and within reasonable bounds
 */
function setTolerance(uint256 newTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
    // Prevent setting tolerance to zero which would brick operations
    if (newTolerance == 0) {
        revert InvalidTolerance(newTolerance);
    }

    // Prevent excessively high tolerance (e.g., 0.01% of base currency unit)
    // This allows for rounding but prevents significant value discrepancies
    uint256 maxTolerance = baseCurrencyUnit / 10000; // 0.01%
    if (newTolerance > maxTolerance) {
        revert InvalidTolerance(newTolerance);
    }

    uint256 oldTolerance = tolerance;
    tolerance = newTolerance;
    emit ToleranceSet(oldTolerance, newTolerance);
}

// Add error
error InvalidTolerance(uint256 tolerance);

// Alternative: Allow higher values but require explicit confirmation
function setToleranceUnchecked(uint256 newTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
    // For emergency situations where bounds need to be exceeded
    // Requires explicit call to this function
    uint256 oldTolerance = tolerance;
    tolerance = newTolerance;
    emit ToleranceSet(oldTolerance, newTolerance);
}
```

---

## Conclusion

The dStable protocol demonstrates strong security fundamentals with comprehensive role-based access controls, reentrancy protection, and careful handling of critical operations. The identified issues are primarily related to edge case handling and operational safeguards rather than critical security vulnerabilities.
