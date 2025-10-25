import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractTransactionReceipt, LogDescription } from "ethers";
import { ethers, getNamedAccounts } from "hardhat";

import { IERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/IERC20";
import { IERC4626 } from "../../typechain-types/@openzeppelin/contracts/interfaces/IERC4626";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { DStakeCollateralVaultV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeCollateralVaultV2.sol";
import { DStakeRouterV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DStakeTokenV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeTokenV2";
import { IDStableConversionAdapterV2 } from "../../typechain-types/contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2";
import {
  createDStakeFixture,
  DStakeFixtureConfig,
  DStakeFixtureResult,
  DStakeFixtureOptions,
  MultiVaultFixtureState,
  DSTAKE_CONFIGS,
  RouterVaultState,
} from "./fixture";

const VAULT_STATUS = {
  Active: 0,
  Suspended: 1,
} as const;

const MAX_NAV_DRIFT = 1n;

type ParsedRouterEvent = ReturnType<DStakeRouterV2["interface"]["parseLog"]> | undefined;

describe("DStakeRouterV2 governance flows", function () {
  DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
    describe(config.DStakeTokenSymbol, function () {
      const options: DStakeFixtureOptions = { multiVault: true };
      const loadFixture = createDStakeFixture(config, options);

      let deployer: HardhatEthersSigner;
      let governance: HardhatEthersSigner;
      let user: HardhatEthersSigner;
      let router: DStakeRouterV2;
      let dStakeToken: DStakeTokenV2;
      let collateralVault: DStakeCollateralVaultV2;
      let dStableToken: ERC20StablecoinUpgradeable;
      let decimals: number;
      let dStakeTokenAddress: string;
      let collateralVaultAddress: string;
      let multiVault: MultiVaultFixtureState;

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

      const toUnits = (value: string) => ethers.parseUnits(value, decimals);

      const depositThroughRouter = async (
        amount: bigint,
        receiver: HardhatEthersSigner = user,
      ): Promise<ContractTransactionReceipt> => {
        await dStableToken.connect(deployer).mint(receiver.address, amount);
        await dStableToken.connect(receiver).approve(dStakeTokenAddress, amount);
        const tx = await dStakeToken.connect(receiver).deposit(amount, receiver.address);
        return tx.wait();
      };

      const absBigInt = (value: bigint) => (value >= 0n ? value : -value);

      const parseRouterEvent = (
        receipt: ContractTransactionReceipt,
        eventName: string,
      ): ParsedRouterEvent => {
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

      const expectNavInvariant = async (before: bigint) => {
        const after = await dStakeToken.totalAssets();
        expect(absBigInt(after - before)).to.be.lte(MAX_NAV_DRIFT);
      };

      beforeEach(async function () {
        const env = (await loadFixture()) as DStakeFixtureResult;
        const named = await getNamedAccounts();
        deployer = await ethers.getSigner(named.deployer);
        governance = await ethers.getSigner(named.user1 ?? named.deployer);
        user = await ethers.getSigner(named.user2 ?? named.deployer);

        router = env.router as DStakeRouterV2;
        dStakeToken = env.DStakeToken as DStakeTokenV2;
        collateralVault = env.collateralVault as DStakeCollateralVaultV2;
        const dStableAddress = await env.dStableToken.getAddress();
        dStableToken = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress)) as ERC20StablecoinUpgradeable;
        decimals = env.dStableInfo.decimals;
        if (!env.multiVault) {
          throw new Error(`multi-vault fixtures not configured for ${config.DStakeTokenSymbol}`);
        }
        multiVault = env.multiVault;

        const rolesToEnsure = [
          await router.STRATEGY_REBALANCER_ROLE(),
          await router.VAULT_MANAGER_ROLE(),
          await router.ADAPTER_MANAGER_ROLE(),
          await router.PAUSER_ROLE(),
        ];
        for (const role of rolesToEnsure) {
          if (!(await router.hasRole(role, governance.address))) {
            await router.connect(governance).grantRole(role, governance.address);
          }
        }

        dStakeTokenAddress = await dStakeToken.getAddress();
        collateralVaultAddress = await collateralVault.getAddress();

        const minterRole = await dStableToken.MINTER_ROLE();
        if (!(await dStableToken.hasRole(minterRole, deployer.address))) {
          await dStableToken.grantRole(minterRole, deployer.address);
        }
      });

      it("suspends the default vault and reroutes deposits", async function () {
        const defaultVault = await router.defaultDepositStrategyShare();

        await router.connect(governance).suspendVaultForRemoval(defaultVault);
        const configAfterSuspension = await router.getVaultConfig(defaultVault);
        expect(configAfterSuspension.targetBps).to.equal(0n);
        expect(Number(configAfterSuspension.status)).to.equal(VAULT_STATUS.Suspended);
        expect(await router.defaultDepositStrategyShare()).to.equal(ethers.ZeroAddress);

        const receipt = await depositThroughRouter(toUnits("180"));
        const reroutedEvent = parseRouterEvent(receipt, "RouterDepositRouted");
        expect(reroutedEvent?.args?.strategyVault).to.not.equal(defaultVault);
      });

      it("rebalances shares directly while preserving NAV", async function () {
        const depositReceipt = await depositThroughRouter(toUnits("400"));
        const depositEvent = parseRouterEvent(depositReceipt, "RouterDepositRouted");
        const fromVault = depositEvent?.args?.strategyVault as string;
        expect(fromVault, "deposit source").to.be.a("string");

        const toVaultConfig = multiVault.vaults.find((vault) => vault.strategyVault !== fromVault);
        if (!toVaultConfig) {
          throw new Error("missing alternate vault for rebalancing");
        }
        const toVault = toVaultConfig.strategyVault;

        const fromBalance = await shareBalance(fromVault);
        const moveAmount = fromBalance / 2n;
        expect(moveAmount).to.be.gt(0n);

        const navBefore = await dStakeToken.totalAssets();
        const receipt = await (
          await router.connect(governance).rebalanceStrategiesByShares(fromVault, toVault, moveAmount, 1n)
        ).wait();
        const event = parseRouterEvent(receipt, "StrategySharesExchanged");
        expect(event?.args?.fromStrategyShare).to.equal(fromVault);
        expect(event?.args?.toStrategyShare).to.equal(toVault);
        expect(event?.args?.fromShareAmount).to.equal(moveAmount);

        await expectNavInvariant(navBefore);
        expect(await shareBalance(toVault)).to.be.gt(0n);
      });

      it("rebalances shares via external liquidity using explicit thresholds", async function () {
        const depositReceipt = await depositThroughRouter(toUnits("450"));
        const depositEvent = parseRouterEvent(depositReceipt, "RouterDepositRouted");
        const primaryVault = depositEvent?.args?.strategyVault as string;
        expect(primaryVault, "primary vault").to.be.a("string");

        const candidateVaults = multiVault.vaults.filter((vault) => vault.strategyVault !== primaryVault);
        if (candidateVaults.length < 2) {
          throw new Error("insufficient vaults for rebalance test");
        }
        const secondary = candidateVaults[0];
        const tertiary = candidateVaults[1];

        const initialPrimaryBalance = await shareBalance(primaryVault);
        await router
          .connect(governance)
          .rebalanceStrategiesByShares(primaryVault, secondary.strategyVault, initialPrimaryBalance / 2n, 1n);

        const fromShares = (await shareBalance(secondary.strategyVault)) / 2n;
        expect(fromShares).to.be.gt(0n);

        const fromAdapter = (await ethers.getContractAt(
          "IDStableConversionAdapterV2",
          secondary.adapter,
        )) as IDStableConversionAdapterV2;
        const dStableEquivalent = await fromAdapter.previewWithdrawFromStrategy(fromShares);
        const toVaultInterface = await getVaultInterface(tertiary.strategyVault);
        const expectedToShares = await toVaultInterface.previewDeposit(dStableEquivalent);
        const minToShares = (expectedToShares * 99n) / 100n;

        const navBefore = await dStakeToken.totalAssets();
        const receipt = await (
          await router
            .connect(governance)
            .rebalanceStrategiesBySharesViaExternalLiquidity(
              secondary.strategyVault,
              tertiary.strategyVault,
              fromShares,
              minToShares,
            )
        ).wait();
        const event = parseRouterEvent(receipt, "StrategySharesExchanged");
        expect(event?.args?.fromStrategyShare).to.equal(secondary.strategyVault);
        expect(event?.args?.toStrategyShare).to.equal(tertiary.strategyVault);

        await expectNavInvariant(navBefore);
        expect(await shareBalance(tertiary.strategyVault)).to.be.gt(0n);
      });

      it("rebalances by value with deterministic min share thresholds", async function () {
        const depositReceipt = await depositThroughRouter(toUnits("480"));
        const depositEvent = parseRouterEvent(depositReceipt, "RouterDepositRouted");
        const sourceVault = depositEvent?.args?.strategyVault as string;
        expect(sourceVault, "source vault").to.be.a("string");

        const otherVaults = multiVault.vaults.filter((vault) => vault.strategyVault !== sourceVault);
        if (otherVaults.length < 2) {
          throw new Error("expected at least two alternate vaults");
        }
        const secondary = otherVaults[0];
        const tertiary = otherVaults[1];

        const initialBalance = await shareBalance(sourceVault);
        await router
          .connect(governance)
          .rebalanceStrategiesByShares(sourceVault, tertiary.strategyVault, initialBalance / 2n, 1n);

        const tertiaryAdapter = (await ethers.getContractAt(
          "IDStableConversionAdapterV2",
          tertiary.adapter,
        )) as IDStableConversionAdapterV2;
        const tertiaryValue = await tertiaryAdapter.previewWithdrawFromStrategy(await shareBalance(tertiary.strategyVault));
        const transferValue = tertiaryValue / 2n;
        expect(transferValue).to.be.gt(0n);

        const secondaryVaultInterface = await getVaultInterface(secondary.strategyVault);
        const previewShares = await secondaryVaultInterface.previewDeposit(transferValue);
        const minShares = (previewShares * 98n) / 100n;

        const navBefore = await dStakeToken.totalAssets();
        const receipt = await (
          await router
            .connect(governance)
            .rebalanceStrategiesByValue(tertiary.strategyVault, secondary.strategyVault, transferValue, minShares)
        ).wait();
        const event = parseRouterEvent(receipt, "StrategiesRebalanced");
        expect(event?.args?.fromVault).to.equal(tertiary.strategyVault);
        expect(event?.args?.toVault).to.equal(secondary.strategyVault);

        await expectNavInvariant(navBefore);
      });

      it("removes an adapter with dust and restores NAV after reconfiguration", async function () {
        const depositReceipt = await depositThroughRouter(toUnits("420"));
        const depositEvent = parseRouterEvent(depositReceipt, "RouterDepositRouted");
        const targetVault = depositEvent?.args?.strategyVault as string;
        expect(targetVault, "target vault").to.be.a("string");
        const targetConfig = multiVault.vaults.find((vault) => vault.strategyVault === targetVault)!;
        const alternateVault = multiVault.vaults.find((vault) => vault.strategyVault !== targetVault)!;

        const primaryBalance = await shareBalance(targetVault);
        await router
          .connect(governance)
          .rebalanceStrategiesByShares(targetVault, alternateVault.strategyVault, primaryBalance / 3n, 1n);

        const navBeforeRemoval = await dStakeToken.totalAssets();
        const adapterAddress = await router.strategyShareToAdapter(targetVault);

        await router.connect(governance).suspendVaultForRemoval(targetVault);
        expect(await shareBalance(targetVault)).to.be.gt(0n);
        await router.connect(governance).removeAdapter(targetVault);
        expect(await router.strategyShareToAdapter(targetVault)).to.equal(ethers.ZeroAddress);

        await router.connect(governance).setVaultStatus(targetVault, VAULT_STATUS.Active);
        await expect(
          router
            .connect(governance)
            .rebalanceStrategiesByShares(alternateVault.strategyVault, targetVault, 1n, 1n),
        ).to.be.revertedWithCustomError(router, "AdapterNotFound");

        await router.connect(governance).addAdapter(targetVault, adapterAddress);
        await router.connect(governance).updateVaultConfig({
          strategyVault: targetVault,
          adapter: adapterAddress,
          targetBps: targetConfig.targetBps,
          status: VAULT_STATUS.Active,
        });

        const navAfterRestore = await dStakeToken.totalAssets();
        expect(absBigInt(navAfterRestore - navBeforeRemoval)).to.be.lte(MAX_NAV_DRIFT);
      });

      it("keeps routing coherent when vault status flips rapidly", async function () {
        const defaultVault = await router.defaultDepositStrategyShare();
        const toggledVaultConfig = multiVault.vaults.find((vault) => vault.strategyVault !== defaultVault) as RouterVaultState;
        const toggledVault = toggledVaultConfig.strategyVault;

        const depositReceipt = await depositThroughRouter(toUnits("400"));
        const depositEvent = parseRouterEvent(depositReceipt, "RouterDepositRouted");
        const activeVault = depositEvent?.args?.strategyVault as string;
        expect(activeVault, "active vault").to.be.a("string");

        await router.connect(governance).setVaultStatus(toggledVault, VAULT_STATUS.Suspended);
        await router.connect(governance).setVaultStatus(toggledVault, VAULT_STATUS.Active);
        await router.connect(governance).emergencyPauseVault(toggledVault);
        await router.connect(governance).setVaultStatus(toggledVault, VAULT_STATUS.Active);

        const configAfter = await router.getVaultConfig(toggledVault);
        expect(Number(configAfter.status)).to.equal(VAULT_STATUS.Active);
        expect(configAfter.targetBps).to.equal(toggledVaultConfig.targetBps);
        expect(await router.defaultDepositStrategyShare()).to.equal(defaultVault);

        const activeVaults = await router.getActiveVaultsForDeposits();
        expect(activeVaults).to.include(toggledVault);

        const fromBalance = await shareBalance(activeVault);
        const moveAmount = fromBalance / 4n;
        const receipt = await (
          await router
            .connect(governance)
            .rebalanceStrategiesByShares(activeVault, toggledVault, moveAmount, 1n)
        ).wait();
        const event = parseRouterEvent(receipt, "StrategySharesExchanged");
        expect(event?.args?.toStrategyShare).to.equal(toggledVault);
      });
    });
  });
});
