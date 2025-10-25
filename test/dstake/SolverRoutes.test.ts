import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { ethers, getNamedAccounts } from "hardhat";

import { IERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/IERC20";
import { IERC4626 } from "../../typechain-types/@openzeppelin/contracts/interfaces/IERC4626";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { DStakeCollateralVaultV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeCollateralVaultV2.sol";
import { DStakeRouterV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DStakeTokenV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeTokenV2";
import { MockControlledERC4626Adapter } from "../../typechain-types/contracts/testing/dstake/MockControlledERC4626Adapter";
import {
  createDStakeFixture,
  DStakeFixtureConfig,
  DStakeFixtureOptions,
  DStakeFixtureResult,
  DSTAKE_CONFIGS,
  MultiVaultFixtureState,
} from "./fixture";

const VAULT_STATUS = {
  Suspended: 1,
} as const;

const BPS_SCALE = 1_000_000n;

const netAfterFee = (gross: bigint, feeBps: bigint) => {
  if (gross === 0n || feeBps === 0n) {
    return gross;
  }
  if (feeBps >= BPS_SCALE) {
    return 0n;
  }
  const fee = (gross * feeBps) / BPS_SCALE;
  if (fee >= gross) {
    return 0n;
  }
  return gross - fee;
};

interface SolverDepositPlan {
  vaults: string[];
  assetTargets: bigint[];
  shareTargets: bigint[];
  totalAssets: bigint;
}

describe("DStakeRouterV2 solver routes", function () {
  DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
    describe(config.DStakeTokenSymbol, function () {
      const fixtureOptions: DStakeFixtureOptions = { multiVault: true };
      const loadFixture = createDStakeFixture(config, fixtureOptions);

      let deployer: HardhatEthersSigner;
      let solver: HardhatEthersSigner;
      let governance: HardhatEthersSigner;
      let router: DStakeRouterV2;
      let dStakeToken: DStakeTokenV2;
      let dStableToken: ERC20StablecoinUpgradeable;
      let collateralVault: DStakeCollateralVaultV2;
      let multiVault: MultiVaultFixtureState;
      let decimals: number;
      let routerAddress: string;
      let collateralVaultAddress: string;
      let rebalancerRole: string;

      const erc20Cache = new Map<string, IERC20>();
      const erc4626Cache = new Map<string, IERC4626>();

      const getShareToken = async (address: string): Promise<IERC20> => {
        if (!erc20Cache.has(address)) {
          const token = (await ethers.getContractAt(
            "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
            address,
          )) as IERC20;
          erc20Cache.set(address, token);
        }
        return erc20Cache.get(address)!;
      };

      const getVaultInterface = async (address: string): Promise<IERC4626> => {
        if (!erc4626Cache.has(address)) {
          const vault = (await ethers.getContractAt(
            "@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626",
            address,
          )) as IERC4626;
          erc4626Cache.set(address, vault);
        }
        return erc4626Cache.get(address)!;
      };

      const shareBalance = async (vaultAddress: string): Promise<bigint> => {
        const token = await getShareToken(vaultAddress);
        return token.balanceOf(collateralVaultAddress);
      };

      const parseRouterEvent = (
        receipt: ContractTransactionReceipt,
        eventName: string,
      ): ReturnType<DStakeRouterV2["interface"]["parseLog"]> | undefined => {
        for (const log of receipt.logs) {
          try {
            const parsed = router.interface.parseLog(log);
            if (parsed && parsed.name === eventName) {
              return parsed;
            }
          } catch {
            continue;
          }
        }
        return undefined;
      };

      const toUnits = (value: string) => ethers.parseUnits(value, decimals);

      const mintAndApproveSolver = async (amount: bigint) => {
        await dStableToken.connect(deployer).mint(solver.address, amount);
        await dStableToken.connect(solver).approve(routerAddress, amount);
      };

      const seedSolverDeposit = async (): Promise<SolverDepositPlan> => {
        const candidateVaults = multiVault.vaults.slice(0, 2).map((cfg) => cfg.strategyVault);
        if (candidateVaults.length < 2) {
          throw new Error("multi-vault configuration missing secondary strategies");
        }

        const assetTargets = [toUnits("320"), toUnits("180")];
        const shareTargets = await Promise.all(
          candidateVaults.map(async (vault, idx) => {
            const vaultInterface = await getVaultInterface(vault);
            return vaultInterface.previewDeposit(assetTargets[idx]);
          }),
        );
        const totalAssets = assetTargets.reduce((acc, amount) => acc + amount, 0n);

        await mintAndApproveSolver(totalAssets);
        const minShares = await dStakeToken.previewDeposit(totalAssets);
        await (
          await router.connect(solver).solverDepositShares(candidateVaults, shareTargets, minShares, solver.address)
        ).wait();

        return {
          vaults: candidateVaults,
          assetTargets,
          shareTargets,
          totalAssets,
        };
      };

      const getControlledAdapter = async (vault: string): Promise<MockControlledERC4626Adapter> => {
        const adapterAddress = multiVault.controllableAdapters?.[vault];
        if (!adapterAddress) {
          throw new Error(`no controllable adapter registered for ${vault}`);
        }
        return (await ethers.getContractAt(
          "MockControlledERC4626Adapter",
          adapterAddress,
        )) as MockControlledERC4626Adapter;
      };

      beforeEach(async function () {
        const env = (await loadFixture()) as DStakeFixtureResult;
        const named = await getNamedAccounts();
        deployer = await ethers.getSigner(named.deployer);
        solver = await ethers.getSigner(named.user2 ?? named.deployer);
        governance = await ethers.getSigner(named.user1 ?? named.deployer);

        router = env.router as DStakeRouterV2;
        dStakeToken = env.DStakeToken as DStakeTokenV2;
        collateralVault = env.collateralVault as DStakeCollateralVaultV2;

        const dStableAddress = await env.dStableToken.getAddress();
        dStableToken = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          dStableAddress,
        )) as ERC20StablecoinUpgradeable;
        decimals = env.dStableInfo.decimals;

        if (!env.multiVault) {
          throw new Error(`multi-vault fixture unavailable for ${config.DStakeTokenSymbol}`);
        }
        multiVault = env.multiVault;

        routerAddress = await router.getAddress();
        collateralVaultAddress = await collateralVault.getAddress();

        rebalancerRole = await router.STRATEGY_REBALANCER_ROLE();
        const vaultManagerRole = await router.VAULT_MANAGER_ROLE();

        if (!(await router.hasRole(rebalancerRole, governance.address))) {
          await router.connect(governance).grantRole(rebalancerRole, governance.address);
        }
        if (!(await router.hasRole(vaultManagerRole, governance.address))) {
          await router.connect(governance).grantRole(vaultManagerRole, governance.address);
        }

        const minterRole = await dStableToken.MINTER_ROLE();
        if (!(await dStableToken.hasRole(minterRole, deployer.address))) {
          await dStableToken.grantRole(minterRole, deployer.address);
        }
      });

      it("routes solver deposits across multiple vault share targets", async function () {
        const targetVaults = multiVault.vaults.slice(0, 2).map((cfg) => cfg.strategyVault);
        const assetTargets = [toUnits("200"), toUnits("140")];
        const shareTargets = await Promise.all(
          targetVaults.map(async (vault, idx) => {
            const vaultInterface = await getVaultInterface(vault);
            return vaultInterface.previewDeposit(assetTargets[idx]);
          }),
        );

        const balancesBefore = await Promise.all(targetVaults.map((vault) => shareBalance(vault)));
        const totalAssets = assetTargets.reduce((acc, amount) => acc + amount, 0n);
        const minShares = await dStakeToken.previewDeposit(totalAssets);

        await mintAndApproveSolver(totalAssets);
        const receipt = await (
          await router.connect(solver).solverDepositShares(targetVaults, shareTargets, minShares, solver.address)
        ).wait();

        const depositEvent = parseRouterEvent(receipt, "RouterSolverDeposit");
        expect(depositEvent?.args?.sharesMinted).to.equal(minShares);
        expect(depositEvent?.args?.totalAssets).to.equal(totalAssets);

        const balancesAfter = await Promise.all(targetVaults.map((vault) => shareBalance(vault)));
        balancesAfter.forEach((after, idx) => {
          expect(after - balancesBefore[idx]).to.equal(shareTargets[idx]);
        });

        expect(await dStakeToken.balanceOf(solver.address)).to.equal(minShares);
      });

      it("rejects solver deposits when min share requirements are not met", async function () {
        const targetVaults = multiVault.vaults.slice(0, 2).map((cfg) => cfg.strategyVault);
        const assetTargets = [toUnits("120"), toUnits("80")];
        const shareTargets = await Promise.all(
          targetVaults.map(async (vault, idx) => {
            const vaultInterface = await getVaultInterface(vault);
            return vaultInterface.previewDeposit(assetTargets[idx]);
          }),
        );
        const totalAssets = assetTargets.reduce((acc, amount) => acc + amount, 0n);
        const previewShares = await dStakeToken.previewDeposit(totalAssets);

        await mintAndApproveSolver(totalAssets);
        await expect(
          router.connect(solver).solverDepositShares(targetVaults, shareTargets, previewShares + 1n, solver.address),
        )
          .to.be.revertedWithCustomError(router, "SharesBelowMinimum")
          .withArgs(previewShares, previewShares + 1n);
      });

      it("blocks deposits into suspended vaults", async function () {
        const targetVault = multiVault.vaults[1]?.strategyVault;
        if (!targetVault) {
          throw new Error("missing target vault for suspension test");
        }
        await router.connect(governance).setVaultStatus(targetVault, VAULT_STATUS.Suspended);

        const assetAmount = toUnits("50");
        const shareAmount = await (await getVaultInterface(targetVault)).previewDeposit(assetAmount);
        const assetsNeeded = await (await getVaultInterface(targetVault)).previewMint(shareAmount);

        await mintAndApproveSolver(assetsNeeded);
        await expect(
          router.connect(solver).solverDepositShares([targetVault], [shareAmount], 0n, solver.address),
        )
          .to.be.revertedWithCustomError(router, "VaultNotActive")
          .withArgs(targetVault);
      });

      it("bubbles adapter deposit failures without updating vault balances", async function () {
        const controlledVault = multiVault.vaults.find((cfg) => multiVault.controllableAdapters?.[cfg.strategyVault]);
        if (!controlledVault) {
          throw new Error("no controllable vault available");
        }
        const adapter = await getControlledAdapter(controlledVault.strategyVault);
        await adapter.setDepositFailure(true);

        const assetAmount = toUnits("60");
        const shareAmount = await (await getVaultInterface(controlledVault.strategyVault)).previewDeposit(assetAmount);
        await mintAndApproveSolver(assetAmount);

        const balanceBefore = await shareBalance(controlledVault.strategyVault);
        await expect(
          router.connect(solver).solverDepositShares([controlledVault.strategyVault], [shareAmount], 0n, solver.address),
        )
          .to.be.revertedWithCustomError(adapter, "AdapterForcedFailure")
          .withArgs("deposit");

        expect(await shareBalance(controlledVault.strategyVault)).to.equal(balanceBefore);
      });

      it("withdraws explicit strategy shares for a solver while respecting max share burn", async function () {
        const plan = await seedSolverDeposit();
        const withdrawShares = plan.shareTargets.map((shares) => shares / 2n);
        const balancesBefore = await Promise.all(plan.vaults.map((vault) => shareBalance(vault)));

        const grossAssets = await Promise.all(
          withdrawShares.map(async (shares, idx) => {
            const vaultInterface = await getVaultInterface(plan.vaults[idx]);
            return vaultInterface.previewRedeem(shares);
          }),
        );
        const totalGrossAssets = grossAssets.reduce((acc, amount) => acc + amount, 0n);
        const feeBps = await router.withdrawalFeeBps();
        const expectedNetAssets = netAfterFee(totalGrossAssets, feeBps);
        const maxShares = await dStakeToken.previewWithdraw(expectedNetAssets);

        const solverDStableBefore = await dStableToken.balanceOf(solver.address);
        const receipt = await (
          await router
            .connect(solver)
            .solverWithdrawShares(plan.vaults, withdrawShares, maxShares, solver.address, solver.address)
        ).wait();

        const withdrawEvent = parseRouterEvent(receipt, "RouterSolverWithdraw");
        expect(withdrawEvent?.args?.netAssets).to.equal(expectedNetAssets);
        expect(withdrawEvent?.args?.sharesBurned).to.equal(maxShares);

        const solverDStableAfter = await dStableToken.balanceOf(solver.address);
        expect(solverDStableAfter - solverDStableBefore).to.equal(expectedNetAssets);

        const balancesAfter = await Promise.all(plan.vaults.map((vault) => shareBalance(vault)));
        balancesAfter.forEach((after, idx) => {
          expect(balancesBefore[idx] - after).to.equal(withdrawShares[idx]);
        });
      });

      it("reverts share withdrawals when the solver-specified maxShares is exceeded", async function () {
        const plan = await seedSolverDeposit();
        const withdrawShares = plan.shareTargets.map((shares) => shares / 3n);
        const grossAssets = await Promise.all(
          withdrawShares.map(async (shares, idx) => {
            const vaultInterface = await getVaultInterface(plan.vaults[idx]);
            return vaultInterface.previewRedeem(shares);
          }),
        );
        const totalGrossAssets = grossAssets.reduce((acc, amount) => acc + amount, 0n);
        const feeBps = await router.withdrawalFeeBps();
        const netAssets = netAfterFee(totalGrossAssets, feeBps);
        const previewShares = await dStakeToken.previewWithdraw(netAssets);

        await expect(
          router
            .connect(solver)
            .solverWithdrawShares(plan.vaults, withdrawShares, previewShares - 1n, solver.address, solver.address),
        )
          .to.be.revertedWithCustomError(router, "SharesExceedMaxRedeem")
          .withArgs(previewShares, previewShares - 1n);
      });

      it("surfaces adapter withdrawal failures from controllable strategies", async function () {
        const plan = await seedSolverDeposit();
        const targetVault = plan.vaults.find((vault) => multiVault.controllableAdapters?.[vault]);
        if (!targetVault) {
          throw new Error("missing controllable vault to test withdrawal failures");
        }
        const adapter = await getControlledAdapter(targetVault);
        await adapter.setWithdrawFailure(true);

        const shareAmount = plan.shareTargets[plan.vaults.indexOf(targetVault)] / 4n;
        const withdrawalShares = plan.vaults.map((vault) => (vault === targetVault ? shareAmount : 0n));

        await expect(
          router
            .connect(solver)
            .solverWithdrawShares(plan.vaults, withdrawalShares, ethers.MaxUint256, solver.address, solver.address),
        ).to.be.revertedWithCustomError(router, "ShareWithdrawalConversionFailed");
      });

      it("withdraws by net assets and enforces solver max share burn", async function () {
        const plan = await seedSolverDeposit();
        const assetRequests = plan.assetTargets.map((amount) => amount / 5n);
        const totalNetAssets = assetRequests.reduce((acc, amount) => acc + amount, 0n);
        const previewShares = await dStakeToken.previewWithdraw(totalNetAssets);

        const solverDStableBefore = await dStableToken.balanceOf(solver.address);
        const receipt = await (
          await router
            .connect(solver)
            .solverWithdrawAssets(plan.vaults, assetRequests, previewShares, solver.address, solver.address)
        ).wait();

        const withdrawEvent = parseRouterEvent(receipt, "RouterSolverWithdraw");
        expect(withdrawEvent?.args?.netAssets).to.equal(totalNetAssets);

        const solverDStableAfter = await dStableToken.balanceOf(solver.address);
        expect(solverDStableAfter - solverDStableBefore).to.equal(totalNetAssets);
      });

      it("reverts asset-based withdrawals when the solver-provided maxShares is too low", async function () {
        const plan = await seedSolverDeposit();
        const assetRequests = plan.assetTargets.map((amount) => amount / 6n);
        const totalNetAssets = assetRequests.reduce((acc, amount) => acc + amount, 0n);
        const previewShares = await dStakeToken.previewWithdraw(totalNetAssets);

        await expect(
          router
            .connect(solver)
            .solverWithdrawAssets(plan.vaults, assetRequests, previewShares - 1n, solver.address, solver.address),
        )
          .to.be.revertedWithCustomError(router, "SharesExceedMaxRedeem")
          .withArgs(previewShares, previewShares - 1n);
      });

      it("exchanges strategy shares via the rebalancer helper and emits diagnostics", async function () {
        const plan = await seedSolverDeposit();
        const fromVault = plan.vaults[0];
        const toVault = plan.vaults[1];
        const transferAmount = plan.shareTargets[0] / 4n;

        const navBefore = await dStakeToken.totalAssets();
        const receipt = await (
          await router.connect(governance).rebalanceStrategiesByShares(fromVault, toVault, transferAmount, 1n)
        ).wait();
        const event = parseRouterEvent(receipt, "StrategySharesExchanged");

        expect(event?.args?.fromStrategyShare).to.equal(fromVault);
        expect(event?.args?.toStrategyShare).to.equal(toVault);
        expect(event?.args?.fromShareAmount).to.equal(transferAmount);

        const navAfter = await dStakeToken.totalAssets();
        expect(navAfter).to.equal(navBefore);
      });

      it("requires the strategy rebalancer role for collateral exchanges", async function () {
        const plan = await seedSolverDeposit();
        const fromVault = plan.vaults[0];
        const toVault = plan.vaults[1];

        await expect(
          router.connect(solver).rebalanceStrategiesByShares(fromVault, toVault, plan.shareTargets[0] / 5n, 1n),
        )
          .to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount")
          .withArgs(solver.address, rebalancerRole);
      });
    });
  });
});
