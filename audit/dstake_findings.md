# DStake System - Comprehensive Audit Report

**Audit Date:** November 2025
**Auditor:** HASHLOCK Security Researchers
**Protocol:** dTRINITY - DStake Module
**Repository:** DTrinity

---

## Executive Summary

This audit report presents findings from a comprehensive security review of the DStake system, including core contracts, adapters, reward mechanisms, and accounting flows. The audit identified 1 Medium severity issue, 2 Low severity issues, 6 QA/Informational findings, and 2 issues from code review tags. The DStake system demonstrates solid architectural design with proper access controls and reentrancy protections, but several edge cases and operational risks require attention.

---

## Table of Contents

1. [Medium Severity Findings](#medium-severity-findings)
2. [Low Severity Findings](#low-severity-findings)
3. [QA / Informational Findings](#qa--informational-findings)
4. [Code Review Tag Findings](#code-review-tag-findings)

---

## Medium Severity Findings

### M-01: Router Migration During Active Shortfall Causes Instant Share Price Inflation

**Title:** Router Migration During Active Shortfall Causes Instant Share Price Inflation

**Description:** The DStakeTokenV2 contract allows migration to a new router while an active shortfall exists, causing the new router to start with zero shortfall and instantly inflating the share price.

**Vulnerability Details:**

The `DStakeTokenV2.totalAssets()` function calculates net assets by subtracting the router's current shortfall:

```solidity
function totalAssets() public view virtual override returns (uint256) {
    uint256 grossAssets = _grossTotalAssets();
    if (grossAssets == 0) {
        return 0;
    }

    uint256 shortfall = address(router) == address(0) ? 0 : router.currentShortfall();
    return shortfall >= grossAssets ? 0 : grossAssets - shortfall;
}
```

However, the `migrateCore()` function does not verify that the shortfall has been cleared before migration:

```solidity
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
    // No check for router.currentShortfall() == 0
}
```

When governance migrates to a new router while the old router has an active shortfall, the new router starts with `settlementShortfall == 0` by default. This causes `totalAssets()` to immediately jump from `(grossAssets - oldShortfall)` to `grossAssets`, artificially inflating the share price. Consider a scenario where the protocol has $10M in gross assets with a $2M shortfall recorded. The share price reflects $8M in net value. After migration to a new router with zero shortfall, `totalAssets()` suddenly returns $10M, causing a 25% instant share price increase. This allows depositors who enter immediately after migration to capture value that should have been socialized across existing shareholders until the shortfall was legitimately resolved. The issue breaks fair-value accounting principles and enables value extraction through privileged knowledge of pending migrations.

**Impact:**

The vulnerability enables instant share price manipulation through administrative action, creating an unfair advantage for depositors with advance knowledge of router migrations. Existing shareholders who held positions during the shortfall period effectively subsidize new depositors who enter after migration, violating the principle that losses should be socialized across all participants. The impact extends beyond individual unfairness to protocol reputation, as the sudden share price jump appears as accounting manipulation rather than legitimate value recovery. This undermines trust in the protocol's financial transparency and could trigger regulatory scrutiny. The risk is particularly acute because router migrations are governance-controlled events that might be predictable to insiders, creating opportunities for front-running or coordinated extraction of value from existing shareholders.

**Recommendation:**

Add a shortfall verification requirement in the `migrateCore()` function to prevent migration while losses remain unresolved. The check should revert if any shortfall exists, forcing governance to either clear the shortfall through capital injection or explicitly account for it via the new router's `recordShortfall()` function before migration completes. Implement the fix by adding a requirement at the beginning of the migration function that verifies the current router's shortfall is zero. This simple check ensures that any recorded losses are properly resolved or carried forward before the accounting context changes, maintaining fair-value integrity across router upgrades. Additionally, consider emitting an event when shortfalls are detected during migration attempts to provide transparency into why migrations might be blocked and encourage proper shortfall resolution procedures.

**Location:** `contracts/vaults/dstake/DStakeTokenV2.sol` - `migrateCore()` function

**Recommended Code Fix:**
```solidity
function migrateCore(address newRouter, address newCollateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (newRouter == address(0) || newCollateralVault == address(0)) {
        revert ZeroAddress();
    }

    // Require shortfall to be cleared before migration
    if (address(router) != address(0)) {
        require(router.currentShortfall() == 0, "ShortfallActive");
    }

    IDStakeRouterV2 routerCandidate = IDStakeRouterV2(newRouter);
    // ... rest of migration logic
}
```

---

## Low Severity Findings

### L-01: Emission Schedule Does Not Validate Sufficient Reserve Funding

**Title:** Emission Schedule Does Not Validate Sufficient Reserve Funding

**Description:** The DStakeIdleVault allows setting emission schedules without verifying that sufficient reward reserves exist to cover the entire emission period.

**Vulnerability Details:**

The `setEmissionSchedule()` function accepts parameters for emission start time, end time, and per-second emission rate, but does not validate that the current `rewardReserve` contains enough tokens to sustain emissions for the entire configured duration:

```solidity
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
```

This creates a situation where emissions can be configured for 30 days but only 11 days worth of rewards are funded. When the reserve depletes at day 11, the `_pendingEmission()` function caps the return value at the remaining reserve, causing emissions to silently stop 19 days early. The emission calculation includes a safety cap but does not alert operators or users that the reserve is insufficient. Consider a configuration where emissions are set to distribute 1 token per second for 30 days, requiring 2,592,000 tokens total, but only 1,000,000 tokens are funded. After approximately 11.57 days, the reserve hits zero and `_pendingEmission()` begins returning zero for all subsequent calls. Users continue depositing into the vault expecting 30 days of rewards, but receive nothing after day 11, resulting in significantly lower APY than advertised. The situation can also occur if the reward manager withdraws unreleased rewards mid-stream using `withdrawUnreleasedRewards()`, deliberately or accidentally creating a shortfall that causes emissions to stop before the configured end time.

**Impact:**

The lack of upfront validation allows emission schedules to be configured with insufficient funding, leading to premature termination of rewards and user disappointment. Depositors who enter the vault based on advertised APY calculations assume rewards will continue through the configured end date, but instead experience a sharp drop to zero yield partway through the period. This creates an unfair situation where early depositors receive rewards while later depositors receive nothing, despite both groups having reasonable expectations based on the configured schedule. The silent failure mechanism provides no notification when reserves deplete early, leaving users without visibility into why their expected returns suddenly stopped. This could damage protocol reputation and user trust, particularly if the shortfall results from administrative error rather than intentional adjustment. The issue extends to withdrawal patterns, as users may delay withdrawals expecting continued rewards, only to discover retroactively that they missed the optimal exit timing when emissions actually stopped.

**Recommendation:**

Implement validation logic in `setEmissionSchedule()` to verify that the current reward reserve contains sufficient tokens to cover the entire emission period at the specified rate. Calculate the total required reserves as `(end - start) * rate` and compare against the current `rewardReserve` balance, reverting if insufficient funds exist. This upfront check prevents configuration errors and forces operators to fund rewards adequately before activating emission schedules. Additionally, consider adding a view function that returns whether the current reserve is sufficient for the configured schedule, allowing front-ends and monitoring systems to detect potential shortfalls before they impact users. For enhanced transparency, emit a warning event when reserve levels drop below the amount needed to sustain emissions through the configured end time, providing advance notice to operators that additional funding is required to maintain the advertised reward rate.

**Location:** `contracts/vaults/dstake/vaults/DStakeIdleVault.sol` - `setEmissionSchedule()` function

**Recommended Code Fix:**
```solidity
function setEmissionSchedule(uint64 start, uint64 end, uint256 rate) external onlyRole(REWARD_MANAGER_ROLE) {
    if (end != 0 && end <= start) {
        revert InvalidEmissionWindow();
    }
    _accrue();

    // Validate sufficient reserves for the entire emission period
    if (end != 0 && rate > 0) {
        uint256 duration = uint256(end - start);
        uint256 requiredReserve = duration * rate;
        if (rewardReserve < requiredReserve) {
            revert InsufficientRewardReserve();
        }
    }

    emissionStart = start;
    emissionEnd = end;
    emissionPerSecond = rate;
    lastEmissionUpdate = uint64(block.timestamp);

    emit EmissionScheduleSet(start, end, rate);
}
```

---

### L-02: Vault Removal Without Balance Check Causes totalAssets() Desynchronization

**Title:** Vault Removal Without Balance Check Causes totalAssets() Desynchronization

**Description:** The router allows removing vault configurations while the collateral vault still holds significant strategy share balances, causing permanent deflation of totalAssets() and value loss for shareholders.

**Vulnerability Details:**

The `removeSupportedStrategyShare()` function in DStakeCollateralVaultV2 was modified to remove the balance check that prevented removal of vaults with remaining shares, in order to address a griefing vector where attackers could donate 1 wei to block removal:

```solidity
function removeSupportedStrategyShare(address strategyShare) external onlyRole(ROUTER_ROLE) {
    if (!_isSupported(strategyShare)) revert StrategyShareNotSupported(strategyShare);

    // OLD CODE (removed to prevent griefing):
    // if (IERC20(strategyShare).balanceOf(address(this)) > 0) revert NonZeroBalance();

    _supportedStrategyShares.remove(strategyShare);
    emit StrategyShareRemoved(strategyShare);
}
```

However, removing this check created a more severe vulnerability. The `totalValueInDStable()` function only counts strategy shares that are present in the `_supportedStrategyShares` enumerable set. When a vault is removed from this set while the collateral vault still holds its shares, those shares are excluded from TVL calculations. Consider a protocol with $100M TVL split equally between Vault A ($50M) and Vault B ($50M). An administrator removes Vault B from the configuration to deprecate it, planning to withdraw the funds later. The moment removal occurs, `totalValueInDStable()` drops to $50M because it only iterates supported strategy shares and Vault B is no longer in the set. Share price instantly halves from the user perspective, causing `previewRedeem()` to return half the expected assets. Users who redeem 10 shares expecting $200 now receive only $100, experiencing direct value loss despite the underlying assets remaining intact in the collateral vault. The removed griefing check solved a denial-of-service attack but replaced it with an accounting desynchronization vulnerability that enables much larger value extraction.

**Impact:**

The vulnerability causes immediate and severe value loss for all shareholders whenever a vault is removed from configuration while holding non-trivial balances. Users who attempt redemptions after vault removal receive significantly fewer assets than expected, with the deficit percentage equal to the removed vault's proportion of total TVL. A $50M vault removal from $100M total causes a 50% value loss per redemption, while a $10M removal from $20M total causes the same 50% loss proportionally. The impact is not limited to users who happen to redeem during the window; all existing shareholders experience permanent share price deflation until the issue is corrected by re-adding the vault or manually withdrawing the orphaned shares. The vulnerability is particularly dangerous because vault removal is an administrative operation that users cannot anticipate, potentially catching the entire user base off-guard with sudden balance drops. This could trigger a bank run as users race to withdraw before others, exacerbating the chaos. The original griefing protection rationale becomes moot when the cure is worse than the disease; a 1 wei donation attack merely blocks removal, while the unprotected removal causes multi-million dollar accounting errors.

**Recommendation:**

Implement a dual-threshold approach that prevents griefing while protecting against accounting desynchronization. Define both an absolute dust threshold (e.g., 1 USDC worth) and a relative dust threshold (e.g., 0.1% of total TVL), requiring balances to fall below both limits before removal is permitted. This allows removal when balances are truly negligible while blocking removal of material positions. The check should use the adapter's `strategyShareValueInDStable()` function to value remaining shares in real terms rather than raw token amounts, ensuring the threshold is meaningful across different asset types and price points. Consider implementing a two-stage removal process where vaults are first suspended to block new deposits while remaining in the supported shares enumeration for TVL calculations, then removed only after balances are withdrawn to dust levels. Additionally, require explicit governance acknowledgment via a separate signature or timelock when removing vaults with balances above the dust threshold, creating friction that encourages proper withdrawal procedures before configuration changes.

**Location:** `contracts/vaults/dstake/DStakeCollateralVaultV2.sol` - `removeSupportedStrategyShare()` function, `contracts/vaults/dstake/DStakeRouterV2.sol` - vault removal flows

**Recommended Code Fix:**
```solidity
uint256 public constant DUST_THRESHOLD_BPS = 10; // 0.1% of TVL
uint256 public constant ABSOLUTE_DUST_THRESHOLD = 1e6; // 1 USDC equivalent

function removeSupportedStrategyShare(address strategyShare) external onlyRole(ROUTER_ROLE) {
    if (!_isSupported(strategyShare)) revert StrategyShareNotSupported(strategyShare);

    uint256 balance = IERC20(strategyShare).balanceOf(address(this));

    if (balance > 0) {
        address adapterAddress = IAdapterProvider(router).strategyShareToAdapter(strategyShare);
        if (adapterAddress != address(0)) {
            uint256 value = IDStableConversionAdapterV2(adapterAddress)
                .strategyShareValueInDStable(strategyShare, balance);

            // Check 1: Must be less than absolute threshold
            if (value > ABSOLUTE_DUST_THRESHOLD) {
                revert SignificantBalanceRemaining(strategyShare, value, ABSOLUTE_DUST_THRESHOLD);
            }

            // Check 2: Must be less than % of total TVL
            uint256 totalValue = totalValueInDStable();
            uint256 maxAllowedDust = (totalValue * DUST_THRESHOLD_BPS) / 10000;

            if (value > maxAllowedDust) {
                revert ExceedsDustThreshold(strategyShare, value, maxAllowedDust);
            }
        }
    }

    _supportedStrategyShares.remove(strategyShare);
    emit StrategyShareRemoved(strategyShare);
}
```

---

## QA / Informational Findings

### QA-01: Missing Emergency Withdrawal in GenericERC4626ConversionAdapter

**Title:** Missing Emergency Withdrawal in GenericERC4626ConversionAdapter

**Description:** The GenericERC4626ConversionAdapter lacks an emergency withdrawal function to recover stuck dStable tokens that may remain after failed or partial deposits.

**Vulnerability Details:**

The `GenericERC4626ConversionAdapter` implements the standard deposit and withdrawal flows for ERC4626 vaults, but unlike the `MetaMorphoConversionAdapter`, it does not include an emergency withdrawal mechanism. During the deposit operation, the adapter transfers dStable from the caller, approves the vault, and attempts to deposit. If the vault's deposit function has any unusual behavior such as accepting only partial amounts, reverting under certain conditions, or experiencing reentrancy issues, some dStable could remain in the adapter contract with no administrative function to retrieve it. The adapter uses `forceApprove()` to set the vault allowance but does not reset the approval to zero after the deposit completes, unlike other adapters in the system. While the contract is not designed to hold funds between operations, edge cases in external vault behavior could leave tokens stranded. The `MetaMorphoConversionAdapter` includes an `emergencyWithdraw()` function protected by `DEFAULT_ADMIN_ROLE` to handle such scenarios, but `GenericERC4626ConversionAdapter` omits this safety feature despite facing similar risks when interacting with potentially arbitrary ERC4626 implementations.

**Impact:**

The missing emergency withdrawal capability means that any dStable tokens that become stuck in the adapter due to unexpected vault behavior are permanently lost to the protocol. While the likelihood of such an occurrence is low given standard ERC4626 behavior, the GenericERC4626ConversionAdapter is explicitly designed to work with any compliant vault, including potentially poorly implemented or malicious ones. The lack of a recovery mechanism creates an asymmetric risk where downside scenarios trap funds but upside scenarios provide no corresponding benefit. The impact is limited to operational losses rather than user fund theft, as the adapter only temporarily holds funds during transaction execution, but represents a deficiency in defensive design. The inconsistency with other adapters in the same system suggests an oversight rather than intentional design choice, creating confusion for operators who may expect uniform emergency procedures across all adapter contracts. Recovery would require deploying a new adapter and updating router configurations, a significantly more complex process than simply calling an emergency function.

**Recommendation:**

Implement an `emergencyWithdraw()` function in `GenericERC4626ConversionAdapter` matching the pattern used in `MetaMorphoConversionAdapter`. The function should accept a token address and amount, verify the caller has `DEFAULT_ADMIN_ROLE`, and transfer the specified tokens to the caller. Include appropriate events for transparency and ensure the function cannot be used to extract tokens during normal operations by potentially adding a time delay or requiring the adapter to be in a paused state. Consider also adding the approval reset to zero after deposit operations to match the hygiene practices of other adapters, reducing the surface area for potential issues. Update documentation to describe the emergency procedures and conditions under which emergency withdrawal would be appropriate, helping operators respond effectively if edge cases occur. Include test cases that simulate partial deposits or unusual vault behavior to validate that emergency withdrawal functions as intended when needed.

**Location:** `contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter.sol`

---

### QA-02: Adapter Functions Callable by Arbitrary Users

**Title:** Adapter Functions Callable by Arbitrary Users

**Description:** Adapter contracts expose deposit and withdrawal functions without restricting callers to the router, allowing users to interact directly with adapters in unintended ways.

**Vulnerability Details:**

The adapter contracts `GenericERC4626ConversionAdapter`, `MetaMorphoConversionAdapter`, and `WrappedDLendConversionAdapter` implement public `depositIntoStrategy()` and `withdrawFromStrategy()` functions with no access control beyond requiring token transfers from the caller. Any user can call these functions directly, providing their own dStable tokens and receiving strategy shares sent to the collateral vault address. When users deposit via adapters, the strategy shares are minted directly to `collateralVault` as intended by the design, but these shares are not associated with any dStake token balance in the user's account. The user has paid dStable to the adapter and received nothing in return since the shares went to the collateral vault, while the router never recorded a deposit on their behalf. The user cannot redeem these orphaned shares because redemption requires burning dStake tokens, which they never received. This creates a situation similar to users interacting directly with Uniswap V2 pair contracts instead of going through the router, an interaction pattern that is technically possible but economically irrational and often leads to loss. The architecture assumes all interactions flow through the router, which properly coordinates token transfers, share minting, and accounting updates, but does not enforce this assumption through access controls on the adapter layer.

**Impact:**

Users who mistakenly interact with adapters directly experience permanent loss of their dStable tokens, receiving strategy shares that are sent to the collateral vault and become irretrievable. This creates a user experience hazard where confusion about the proper interaction flow leads to financial loss. The impact is limited to users who bypass expected interfaces and interact with low-level contracts directly, similar to other DeFi protocols where direct pair contract interaction can cause losses. However, the lack of access control represents a deviation from defense-in-depth principles where unnecessary capabilities are restricted to prevent misuse. Sophisticated users who understand the architecture would never choose to use adapters directly since they could achieve better outcomes by using the underlying vaults directly, making the unrestricted adapter access purely a footgun with no legitimate use case. The issue could be exploited in malicious front-end attacks where a compromised website convinces users to approve and call adapter functions directly, stealing funds through the guise of legitimate protocol interaction.

**Recommendation:**

Restrict adapter deposit and withdrawal functions to only be callable by the router address using a simple access control check. Implement a modifier or require statement that verifies `msg.sender == router` before executing deposit and withdrawal logic, ensuring adapters can only be used through the intended routing architecture. This change has no impact on legitimate protocol flows since the router is already the sole intended caller, but prevents accidental or malicious direct usage. Consider whether adapters should inherit from `AccessControl` or implement a simple immutable router address check in the constructor; the latter is more gas-efficient for this single-purpose access control. Update adapter documentation to clarify that they are internal protocol components not intended for direct user interaction, helping developers and integrators understand the proper usage patterns. Include warnings in comments and NatSpec that direct calls will result in loss of funds. Test cases should verify that non-router callers are properly rejected and that all legitimate router flows continue to function after access restrictions are added.

**Location:** `contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter.sol`, `contracts/vaults/dstake/adapters/MetaMorphoConversionAdapter.sol`, `contracts/vaults/dstake/adapters/WrappedDLendConversionAdapter.sol`

---

### QA-03: Collateral Vault Blocks Rescue of dStable Despite Architecture Not Using It

**Title:** Collateral Vault Blocks Rescue of dStable Despite Architecture Not Using It

**Description:** DStakeCollateralVaultV2 prevents rescuing dStable tokens despite the architecture never intentionally holding dStable in the collateral vault.

**Vulnerability Details:**

The `rescueToken()` function in `DStakeCollateralVaultV2` includes a check that prevents rescuing the dStable asset, treating it as a restricted token alongside supported strategy shares:

```solidity
function rescueToken(
    address token,
    address receiver,
    uint256 amount
) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
    if (receiver == address(0)) revert ZeroAddress();

    if (_isSupported(token)) {
        revert CannotRescueRestrictedToken(token);
    }

    if (token == dStable) {
        revert CannotRescueRestrictedToken(token);
    }

    IERC20(token).safeTransfer(receiver, amount);
    emit TokenRescued(token, receiver, amount);
}
```

However, the DStake architecture never routes dStable through the collateral vault during normal operations. The router handles all dStable transfers, converting them to strategy shares via adapters before the shares are sent to the collateral vault. The only way dStable could end up in the collateral vault is through user error (mistaken transfer), integration bugs, airdrops, or malicious deposits. Preventing rescue of dStable in these scenarios causes permanent loss of funds that were never supposed to be there in the first place. The restriction appears designed to prevent misuse where an admin might try to extract legitimate dStable reserves, but no such reserves exist in the collateral vault by design. The check protects against a threat model that does not match the actual architecture.

**Impact:**

The overly restrictive rescue function causes permanent loss of any dStable tokens accidentally sent to the collateral vault, with no recovery mechanism available to the protocol. Users who mistakenly send dStable directly to the collateral vault address experience irreversible loss, unable to retrieve their funds even with governance intervention. The impact is limited to error scenarios rather than attacks on protocol funds, but represents a recoverable situation made permanent by unnecessary restrictions. The architectural mismatch between the restriction's intent (protecting intentional reserves) and reality (no intentional reserves) suggests confusion about the role of the collateral vault. Protocol operators dealing with user support requests for mistaken transfers would be unable to assist despite having the technical capability to do so. The restriction could also trap dStable resulting from complex DeFi interactions like rebase tokens, bridge issues, or malicious airdrops designed to cause protocol complications.

**Recommendation:**

Remove the dStable restriction from the `rescueToken()` function in `DStakeCollateralVaultV2`, allowing governance to rescue dStable that was never meant to be there. Since the architecture guarantees no legitimate dStable reserves exist in the collateral vault, there is no risk of improperly extracting protocol funds. Consider adding a warning comment explaining that dStable should never legitimately be in the collateral vault, so any rescue operation is recovering erroneously transferred tokens. Implement comprehensive documentation of expected token balances in each contract to help operators distinguish between legitimate rescues and improper extractions. For defense-in-depth, consider adding time delays or multi-signature requirements for rescue operations of significant values to ensure proper review before execution. Update error handling to distinguish between rescuing actively managed assets (strategy shares) versus rescuing tokens that should never be there (dStable), providing clearer operational guidance.

**Location:** `contracts/vaults/dstake/DStakeCollateralVaultV2.sol` - `rescueToken()` function

---

### QA-04: Missing Allowance Reset in GenericERC4626ConversionAdapter

**Title:** Missing Allowance Reset in GenericERC4626ConversionAdapter

**Description:** GenericERC4626ConversionAdapter does not reset token allowance to zero after deposit operations, unlike other adapters in the system.

**Vulnerability Details:**

The `depositIntoStrategy()` function in `GenericERC4626ConversionAdapter` uses `forceApprove()` to grant the vault allowance to spend dStable, but does not reset the allowance to zero after the deposit completes:

```solidity
function depositIntoStrategy(
    uint256 stableAmount
) external override returns (address shareToken, uint256 strategyShareAmount) {
    if (stableAmount == 0) {
        revert InvalidAmount();
    }

    IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);
    IERC20(dStable).forceApprove(address(vault), stableAmount);

    strategyShareAmount = vault.deposit(stableAmount, collateralVault);
    shareToken = address(vault);
    // Missing: IERC20(dStable).forceApprove(address(vault), 0);
}
```

In contrast, both `MetaMorphoConversionAdapter` and `WrappedDLendConversionAdapter` explicitly clear approvals after operations complete. While the adapter is not designed to hold funds between transactions and the exact approval amount is used immediately, leaving residual approvals represents suboptimal hygiene. If the vault implements partial fills or leaves dust amounts, subsequent operations could potentially consume the leftover allowance in unexpected ways. The inconsistency across adapters suggests an oversight rather than intentional optimization.

**Impact:**

The impact of this issue is minimal since the adapter architecture does not hold balances between operations and approvals are set to exact amounts before each deposit. However, the lack of approval reset represents a deviation from security best practices and creates unnecessary trust assumptions about vault behavior. If a vault implementation has any non-standard behavior that leaves dust amounts or if future contract upgrades introduce state, the lingering approval could enable unintended interactions. The inconsistency with other adapters increases maintenance burden and creates confusion about which pattern is correct. The issue is primarily a code quality and defensive programming concern rather than an exploitable vulnerability in the current architecture.

**Recommendation:**

Add an approval reset to zero after the deposit operation completes in `GenericERC4626ConversionAdapter`, matching the pattern used in other adapters. Insert `IERC20(dStable).forceApprove(address(vault), 0);` after the deposit call and before the function returns. This change has minimal gas cost while improving consistency and defensive posture. Consider establishing explicit allowance hygiene standards across all adapter implementations and documenting the rationale. Review whether the `forceApprove` usage is necessary or if standard `approve` would suffice given the reset pattern. Update code review checklists to include verification of approval resets in adapter patterns.

**Location:** `contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter.sol` - `depositIntoStrategy()` function

---

### QA-05: Reward Compounding Requires Threshold Payment to Recover Omitted Tokens

**Title:** Reward Compounding Requires Threshold Payment to Recover Omitted Tokens

**Description:** The RewardClaimable compounding mechanism requires re-paying the exchange threshold to recover rewards from tokens accidentally omitted from the rewardTokens array.

**Vulnerability Details:**

The `compoundRewards()` function in `RewardClaimable` requires the caller to specify an explicit array of reward tokens to process and provide an exchange asset deposit meeting the minimum threshold:

```solidity
function compoundRewards(
    uint256 amount,
    address[] calldata rewardTokens,
    address receiver
) public virtual nonReentrant onlyRole(REWARDS_MANAGER_ROLE) {
    if (amount < exchangeThreshold) {
        revert ExchangeAmountTooLow(amount, exchangeThreshold);
    }
    if (rewardTokens.length == 0) {
        revert ZeroRewardTokens();
    }

    IERC20(exchangeAsset).safeTransferFrom(msg.sender, address(this), amount);
    emit RewardCompounded(exchangeAsset, amount, rewardTokens);

    uint256[] memory rewardAmounts = _claimRewards(rewardTokens, address(this));

    // Process only the specified reward tokens
    for (uint256 i = 0; i < rewardTokens.length; i++) {
        // ... distribution logic
    }

    _processExchangeAssetDeposit(amount);
}
```

If a reward token is accidentally omitted from the `rewardTokens` array during a compounding call, the rewards for that token remain in the manager contract but are not distributed to users. There is no "claim-only" function to process already-claimed rewards without providing a fresh exchange asset deposit. To recover the omitted token's rewards, the operator must call `compoundRewards()` again with a new exchange asset deposit that meets the threshold requirement, essentially paying the threshold amount twice to access all earned rewards. Consider a scenario where a manager earns rewards in TokenA, TokenB, and TokenC, but only includes TokenA and TokenB in the initial compounding call. TokenC rewards accumulate in the contract but cannot be distributed without a subsequent compounding operation including TokenC and a new threshold-meeting exchange deposit.

**Impact:**

The design creates an inefficient recovery path for accidentally omitted reward tokens, forcing the protocol to provide additional exchange asset deposits beyond what is economically necessary. Operators who make mistakes in reward token array construction face a disproportionate cost to recover from the error, potentially discouraging proper reward distribution. The threshold requirement is designed to ensure economic viability of compounding operations but becomes punitive when applied to recovering already-claimed rewards that only need distribution. Users experience delayed access to their pro-rata share of omitted token rewards, waiting for the next compounding operation that includes the missing token. The issue affects operational efficiency rather than security but creates unnecessary friction in the reward distribution process. Protocols with multiple reward tokens face higher operational risk, as the complexity of managing correct token arrays increases the likelihood of omissions.

**Recommendation:**

Implement a separate recovery function that allows distributing already-claimed rewards without requiring a fresh exchange asset deposit. This function should iterate through the manager's token balances, identify any reward tokens with non-zero balances that are not associated with the current compounding operation, and distribute them according to the existing fee structure. Alternatively, modify the reward architecture to maintain a persistent array of valid reward tokens that the contract automatically processes during compounding, removing the need for external specification. Consider adding validation logic that compares the provided `rewardTokens` array against a stored list of expected tokens and emits warnings when mismatches occur, helping operators detect omissions before they cause issues. Implement off-chain monitoring that tracks reward token balances in manager contracts and alerts when unexpected accumulations occur, providing early warning of compounding misconfigurations. Documentation should clearly describe the consequences of omitting tokens from compounding calls and provide operational procedures for recovery scenarios.

**Location:** `contracts/vaults/rewards_claimable/RewardClaimable.sol` - `compoundRewards()` function

---

### Q-06: Missing Last Admin Protection in AccessControl Inheritance

**Title:** Missing Last Admin Protection in AccessControl Inheritance

**Description:** Several contracts inherit OpenZeppelin's AccessControl but do not override revokeRole() and renounceRole() to prevent removal of the last admin.

**Vulnerability Details:**

Multiple contracts in the DStake system inherit from OpenZeppelin's `AccessControl` or `AccessControlUpgradeable` to implement role-based permissions. These contracts rely on the `DEFAULT_ADMIN_ROLE` for critical administrative functions including vault management, adapter configuration, fee adjustments, and emergency operations. However, none of these contracts override the inherited `revokeRole()` or `renounceRole()` functions to include safeguards against accidentally or maliciously removing the last remaining admin. The standard OpenZeppelin implementation allows any admin to revoke their own role or have it revoked by another admin, with no check ensuring at least one admin remains. This creates a scenario where the last admin could renounce their role, either through operator error clicking the wrong function in an admin interface, a compromised admin account executing malicious actions, or a misunderstanding of the current admin set leading to premature role removal. Once the last admin is removed, all functions protected by `onlyRole(DEFAULT_ADMIN_ROLE)` become permanently inaccessible, effectively bricking administrative capabilities. In the context of DStake, this would prevent critical operations including adding or removing vaults, adjusting fee parameters, migrating to new routers, handling emergency pauses, and managing adapter configurations.

**Impact:**

Loss of the last admin role results in permanent administrative paralysis across affected contracts. The protocol would be unable to respond to security incidents, adjust parameters in response to market conditions, onboard new yield strategies, or perform routine maintenance operations. Any security vulnerability discovered after admin loss would be unexploitable by the team but also unpatchable, leaving users at risk. The immutability extends to beneficial changes as well; the protocol could not optimize fee structures, integrate with new DeFi opportunities, or adapt to regulatory requirements. Upgradeability mechanisms become worthless without an admin to execute upgrades. The impact severity is amplified by the DStake system's modular architecture where admin access is required across multiple contracts that coordinate to provide functionality. Losing admin on the token contract prevents router migrations, losing admin on the router prevents vault configuration changes, and losing admin on the collateral vault prevents strategy adjustments. The vulnerability essentially creates a self-destruct mechanism that could be triggered accidentally, requiring expensive and disruptive migration of all user funds to new contract deployments rather than simple role re-assignment.

**Recommendation:**

Override the `revokeRole()` and `renounceRole()` functions in all contracts using AccessControl to include checks that prevent removal of the last admin. Implement a counter or enumeration tracking the number of addresses holding `DEFAULT_ADMIN_ROLE` and revert if an attempted revocation would reduce the count to zero. This simple safeguard prevents accidental lockout while maintaining the flexibility to adjust admin composition during normal operations. Consider implementing a two-step admin transfer process where the existing admin first nominates a new admin, then the new admin accepts the role before the old admin can renounce, ensuring continuous admin coverage throughout transitions. For defense-in-depth, implement a time-locked admin recovery mechanism where a pre-designated recovery address can assign new admins after a substantial delay (e.g., 30 days), providing a last-resort option if admin loss occurs despite protections. Document admin key management procedures and use multi-signature wallets for admin roles to reduce the risk of single points of failure. Testing procedures should include attempting to remove the last admin and verifying that the operation correctly reverts.

**Location:** Multiple contracts including `DStakeRouterV2.sol`, `DStakeTokenV2.sol`, `DStakeCollateralVaultV2.sol`, adapter contracts

**Recommended Code Pattern:**
```solidity
function revokeRole(bytes32 role, address account) public virtual override {
    if (role == DEFAULT_ADMIN_ROLE) {
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) > 1, "Cannot remove last admin");
    }
    super.revokeRole(role, account);
}

function renounceRole(bytes32 role, address account) public virtual override {
    if (role == DEFAULT_ADMIN_ROLE) {
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) > 1, "Cannot remove last admin");
    }
    super.renounceRole(role, account);
}
```

## Code Review Tag Findings

### TAG-01: Redundant Function getWithdrawalFeeBps()

**Title:** Redundant Function getWithdrawalFeeBps()

**Description:** DStakeTokenV2 contains a redundant `getWithdrawalFeeBps()` function that simply calls `withdrawalFeeBps()` with no added functionality.

**Vulnerability Details:**

The contract includes both `withdrawalFeeBps()` and `getWithdrawalFeeBps()` functions:

```solidity
function withdrawalFeeBps() public view returns (uint256) {
    if (address(router) == address(0)) {
        return 0;
    }
    return router.withdrawalFeeBps();
}

function getWithdrawalFeeBps() public view returns (uint256) {
    // @audit - What's the use of this function as withdrawalFeeBps does the same thing
    return withdrawalFeeBps();
}
```

The `getWithdrawalFeeBps()` function provides no additional logic, error handling, or value beyond directly calling `withdrawalFeeBps()`. This creates unnecessary duplication in the contract interface and marginally increases deployment gas costs due to the extra function bytecode.

**Impact:**

The redundant function has minimal impact on functionality or security but represents suboptimal code organization and increased gas costs. The additional function bloats the contract ABI, potentially causing confusion for developers and integrators about which function to use. Having multiple ways to access the same information creates maintenance burden, as future changes to withdrawal fee logic might need to be reflected in multiple locations. The extra bytecode increases deployment costs slightly.

**Recommendation:**

Remove the `getWithdrawalFeeBps()` function entirely, standardizing on `withdrawalFeeBps()` as the single accessor for withdrawal fee information. Before removal, verify that no external contracts or off-chain systems depend on the redundant function. If external dependencies exist, consider a deprecation period where the redundant function remains but is marked as deprecated in documentation. Update any internal contract references to use the primary function. Consider establishing code review standards that catch and eliminate redundant wrappers during development.

**Location:** `contracts/vaults/dstake/DStakeTokenV2.sol:79-81`

---

### TAG-02: reinvestFees() Does Not Follow Checks-Effects-Interactions Pattern

**Title:** reinvestFees() Does Not Follow Checks-Effects-Interactions Pattern

**Description:** The reinvestFees() function performs external calls before emitting events, deviating from the checks-effects-interactions pattern.

**Vulnerability Details:**

The `reinvestFees()` function in DStakeRouterV2 performs token transfers and calls `_depositToAutoVault()` before emitting the final event:

```solidity
function reinvestFees()
    external
    override
    nonReentrant
    whenNotPaused
    returns (uint256 amountReinvested, uint256 incentivePaid) // @audit - Doesn't follow CEI pattern
{
    uint256 balance = IERC20(_dStable).balanceOf(address(this));
    if (balance == 0) {
        return (0, 0);
    }

    uint256 incentive = Math.mulDiv(balance, reinvestIncentiveBps, BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
    if (incentive > 0) {
        IERC20(_dStable).safeTransfer(msg.sender, incentive); // External call
    }

    amountReinvested = balance - incentive;
    if (amountReinvested == 0) {
        emit RouterFeesReinvested(0, incentive, msg.sender);
        return (0, incentive);
    }

    _depositToAutoVault(amountReinvested); // External interactions through adapters
    emit RouterFeesReinvested(amountReinvested, incentive, msg.sender); // Event after interactions
    incentivePaid = incentive;
    return (amountReinvested, incentivePaid);
}
```

While the function is protected by `nonReentrant`, the pattern of performing external interactions before emitting events could cause confusion in event ordering during complex transaction sequences.

**Impact:**

The impact is limited because the `nonReentrant` modifier prevents reentrancy attacks, and OpenZeppelin's SafeERC20 protects against token-level issues. However, the non-standard pattern creates potential for events to be out of order relative to state changes if future modifications remove or relax reentrancy protection. Off-chain systems monitoring events might observe inconsistent state if they query contract state between the external call and event emission. The deviation from established best practices makes the code less maintainable and could confuse auditors or developers working on the codebase.

**Recommendation:**

Restructure the function to emit events immediately after computing all values but before performing external interactions. Move the event emission to occur before the external transfer and deposit calls. While reentrancy protection makes this primarily a code quality issue, adhering to CEI pattern improves code clarity and reduces future risk if access controls change. Consider whether the event needs to be split into multiple events that can be emitted at appropriate points in the execution flow. Review other functions for similar pattern deviations and establish consistent event emission standards across the codebase.

**Location:** `contracts/vaults/dstake/DStakeRouterV2.sol:754-781`

---

## Summary Statistics

**Total Findings:** 12
- Medium Severity: 1
- Low Severity: 3
- QA / Informational: 5
- Code Review Tags: 3

**Contracts Reviewed:**
- DStakeTokenV2.sol
- DStakeRouterV2.sol
- DStakeRouterV2GovernanceModule.sol
- DStakeCollateralVaultV2.sol
- DStakeIdleVault.sol
- GenericERC4626ConversionAdapter.sol
- MetaMorphoConversionAdapter.sol
- WrappedDLendConversionAdapter.sol
- RewardClaimable.sol

---

**End of Report**
