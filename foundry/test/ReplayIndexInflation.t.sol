// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";

/*
 * Replays the March 2026 dLEND index-inflation attack against the LIVE (patched) Ethereum mainnet pool.
 *
 * Original attack mechanism (pre-patch):
 *   1. drive a reserve's aToken supply to dust (attacker is ~the only supplier),
 *   2. inflate the reserve's flash-borrowable liquidity WITHOUT minting aTokens (a direct token
 *      donation to the aToken contract),
 *   3. take a large flash loan; the flash-loan premium was credited to suppliers via
 *      cumulateToLiquidityIndex(premiumToLP, totalSupply) -> a discontinuous liquidity-index jump
 *      because premium is divided by the dust totalSupply,
 *   4. the attacker's dust aToken collateral value (scaledBalance * index) explodes,
 *   5. borrow dUSD against the fake collateral.
 *
 * The patch (FlashLoanLogic._handleFlashLoanRepayment) routes the ENTIRE premium to
 * reserve.accruedToTreasury instead of cumulateToLiquidityIndex, so the supplier-side index jump no
 * longer exists. This test reproduces steps 1-3 against the live pool (even enabling flash loans on
 * the target as the worst case) and asserts the liquidity index does NOT move -> the attack is dead
 * at its root (no fake collateral, so step 4/5 cannot occur).
 *
 * Run: MAINNET_RPC_URL=<url> forge test --match-contract ReplayIndexInflation -vvv
 */

interface IPool {
    function getReserveNormalizedIncome(address asset) external view returns (uint256);

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);

    function POOL_REVISION() external view returns (uint256);
}

interface IPoolConfigurator {
    function setReserveFlashLoaning(address asset, bool enabled) external;
}

interface IERC20m {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function totalSupply() external view returns (uint256);
}

/// @notice Minimal flash-loan receiver that simply repays principal + premium.
contract FlashAttacker {
    IPool public immutable pool;
    address public immutable asset;

    constructor(IPool pool_, address asset_) {
        pool = pool_;
        asset = asset_;
    }

    function executeOperation(
        address asset_,
        uint256 amount,
        uint256 premium,
        address,
        bytes calldata
    ) external returns (bool) {
        // Pool pulls (amount + premium) from this contract on repayment.
        IERC20m(asset_).approve(address(pool), amount + premium);
        return true;
    }

    function attack(uint256 amount) external {
        pool.flashLoanSimple(address(this), asset, amount, "", 0);
    }
}

contract ReplayIndexInflation is Test {
    // ── live Ethereum mainnet addresses (post-patch) ──
    IPool constant POOL = IPool(0x6598DaD18Bda89A0E58A1F427c8CeBc0dE90F153);
    IPoolConfigurator constant CONFIGURATOR = IPoolConfigurator(0x464792C57aEc24C32AfFDe65e6990F2a89695b2a);
    address constant ADMIN = 0xE83c188a7BE46B90715C757A06cF917175f30262; // governance Safe (POOL_ADMIN / RISK_ADMIN)
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf; // the original attack asset
    address constant CBBTC_ATOKEN = 0xEDAF6c1DF26371a72BE5e8227DCB46283A610611;

    address attacker = makeAddr("attacker");

    function setUp() public {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"));
    }

    function test_replay_index_inflation_is_neutralized() public {
        // sanity: we are on the patched pool
        assertEq(POOL.POOL_REVISION(), 2, "live pool is not the patched revision (expected 2)");

        uint256 index0 = POOL.getReserveNormalizedIncome(CBBTC);
        uint256 dustSupply = IERC20m(CBBTC_ATOKEN).totalSupply();
        emit log_named_uint("cbBTC aToken totalSupply (dust)", dustSupply);
        emit log_named_uint("liquidity index BEFORE", index0);

        // ── Step 0 (worst case): enable flash loans on cbBTC. They are OFF in config; the patch must
        //    hold even if this config mitigation were ever flipped. ──
        vm.prank(ADMIN);
        CONFIGURATOR.setReserveFlashLoaning(CBBTC, true);

        // ── Step 1: obtain a large cbBTC amount and DONATE it to the aToken. This inflates the
        //    flash-borrowable liquidity while leaving aToken totalSupply at dust. ──
        uint256 donation = 5e8; // 5 cbBTC (8 decimals)
        deal(CBBTC, attacker, donation);
        vm.prank(attacker);
        IERC20m(CBBTC).transfer(CBBTC_ATOKEN, donation);

        // premium that will be paid into the reserve by the flash loan
        uint128 premBps = POOL.FLASHLOAN_PREMIUM_TOTAL();
        uint256 premium = (donation * premBps) / 10_000;
        emit log_named_uint("flash premium bps", premBps);
        emit log_named_uint("flash premium (cbBTC units)", premium);

        // For contrast: on the PRE-PATCH code the index would have been multiplied by
        // (1 + premium / dustSupply). Show how large that jump WOULD have been.
        if (dustSupply > 0) {
            uint256 wouldBeMultiplierBps = 10_000 + (premium * 10_000) / dustSupply;
            emit log_named_uint("WOULD-BE index multiplier (bps, pre-patch)", wouldBeMultiplierBps);
        }

        // ── Step 2: run the flash loan. The premium is paid into the reserve on repayment. ──
        FlashAttacker fa = new FlashAttacker(POOL, CBBTC);
        deal(CBBTC, address(fa), premium); // fund the premium so repayment (amount + premium) succeeds
        fa.attack(donation);

        // ── Step 3: measure the index after the premium was paid. ──
        uint256 index1 = POOL.getReserveNormalizedIncome(CBBTC);
        emit log_named_uint("liquidity index AFTER", index1);

        // ── ASSERT the harm: the supplier-side liquidity index must NOT have jumped from the premium.
        //    Pre-patch this would be index0 * wouldBeMultiplier (orders of magnitude larger), minting
        //    fake collateral. Patched: premium -> accruedToTreasury, index unchanged.
        //    Tolerance 0.01% absorbs any incidental interest accrual; the would-be jump is >>1%. ──
        assertApproxEqRel(
            index1,
            index0,
            1e14, // 0.01%
            "PATCH FAILED: flash-loan premium moved the liquidity index (index-inflation reproduced)"
        );
    }
}
