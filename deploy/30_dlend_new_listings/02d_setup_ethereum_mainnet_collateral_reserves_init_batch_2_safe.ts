import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ATOKEN_IMPL_ID,
  ATOMIC_MARKET_LISTING_HELPER_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  assertReserveOracleReadiness,
  buildExpectedOracleAssets,
  chunkArray,
  getDecodedReserveConfig,
  hasLiveMarketFeatures,
  INIT_BATCH_TWO_SYMBOLS,
  isReserveStaged,
  normalize,
  parseBooleanEnv,
  resolveTokenAddress,
} from "./common";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral reserve rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;
  const atomicHelperDeployment = await deployments.get(ATOMIC_MARKET_LISTING_HELPER_ID);
  const atomicHelperAddress = atomicHelperDeployment.address;
  const atomicHelper = await ethers.getContractAt("AtomicMarketListingHelper", atomicHelperAddress, signer);
  const [helperOwner, riskAdminRole, assetListingAdminRole] = await Promise.all([
    atomicHelper.owner(),
    aclManager.RISK_ADMIN_ROLE(),
    aclManager.ASSET_LISTING_ADMIN_ROLE(),
  ]);
  const [helperHasRiskAdmin, helperHasAssetListingAdmin] = await Promise.all([
    aclManager.hasRole(riskAdminRole, atomicHelperAddress),
    aclManager.hasRole(assetListingAdminRole, atomicHelperAddress),
  ]);

  if (normalize(helperOwner) !== normalize(managerAddress)) {
    throw new Error(
      [
        `[ownership-check] AtomicMarketListingHelper owner mismatch.`,
        `helper=${atomicHelperAddress}`,
        `owner=${helperOwner}`,
        `expected=${managerAddress}.`,
      ].join(" "),
    );
  }

  if (!helperHasRiskAdmin || !helperHasAssetListingAdmin) {
    throw new Error(
      [
        `[role-check] AtomicMarketListingHelper is missing one or more required roles.`,
        `helper=${atomicHelperAddress}`,
        `riskAdmin=${helperHasRiskAdmin}`,
        `assetListingAdmin=${helperHasAssetListingAdmin}`,
        "Run and execute setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe before generating stage batches.",
      ].join(" "),
    );
  }

  const { address: treasuryAddress } = await deployments.get(TREASURY_PROXY_ID);
  const { address: aTokenImplAddress } = await deployments.get(ATOKEN_IMPL_ID);
  const { address: stableDebtTokenImplAddress } = await deployments.get(STABLE_DEBT_TOKEN_IMPL_ID);
  const { address: variableDebtTokenImplAddress } = await deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID);

  const rolloutSymbols = INIT_BATCH_TWO_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const verifiedOracleAssets = new Set<string>();
  const expectedOracleAssets = buildExpectedOracleAssets(config);
  const initAndStageInputParams: Array<Record<string, unknown>> = [];
  const stageInputParams: Array<Record<string, unknown>> = [];

  for (const symbol of rolloutSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams) {
      continue;
    }

    if (!tokenAddress) {
      throw new Error(`[config-check] Missing token address for ${symbol}. Run preflight and fix the network config before staging.`);
    }

    await assertReserveOracleReadiness({
      hre,
      signer,
      priceOracleAddress,
      priceOracle,
      verifiedOracleAssets,
      expectedOracleAssets,
      symbol,
      asset: tokenAddress,
    });

    const reserveData = await pool.getReserveData(tokenAddress);
    const reserveFactor = BigInt(reserveParams.reserveFactor);
    const supplyCap = BigInt(reserveParams.supplyCap);
    const debtCeiling = BigInt(reserveParams.debtCeiling);

    if (normalize(reserveData.aTokenAddress) !== normalize(ZeroAddress)) {
      const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);
      const aToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", reserveData.aTokenAddress, signer);
      const aTokenSupply = await aToken.totalSupply();

      if (
        isReserveStaged(currentConfig) &&
        currentConfig.reserveFactor === reserveFactor &&
        currentConfig.supplyCap === supplyCap &&
        currentConfig.debtCeiling === debtCeiling
      ) {
        continue;
      }

      if (!currentConfig.active) {
        throw new Error(`[stage-check] Reserve ${symbol} is inactive; manual review is required before staging.`);
      }

      if (currentConfig.paused) {
        throw new Error(`[stage-check] Reserve ${symbol} is paused; manual review is required before staging.`);
      }

      if (!isReserveStaged(currentConfig) && hasLiveMarketFeatures(currentConfig) && aTokenSupply > 0n) {
        const liveMarketMessage = [
          `[stage-check] Reserve ${symbol} is already live with non-zero aToken supply and is not in the staged posture.`,
          `asset=${tokenAddress}`,
          `aToken=${reserveData.aTokenAddress}`,
          `aTokenSupply=${aTokenSupply.toString()}`,
        ].join(" ");

        if (parseBooleanEnv("NEW_LISTINGS_SKIP_LIVE_RESERVES", false)) {
          console.log(`⏭️  ${liveMarketMessage} Skipping (NEW_LISTINGS_SKIP_LIVE_RESERVES=true).`);
          continue;
        }

        throw new Error(`${liveMarketMessage} Refusing to mutate a live market through the stage script.`);
      }

      stageInputParams.push({
        asset: tokenAddress,
        reserveFactor,
        supplyCap,
        debtCeiling,
      });
      continue;
    }

    const strategyDeployment = await deployments.get(`ReserveStrategy-${reserveParams.strategy.name}`);
    const token = await ethers.getContractAt("IERC20Detailed", tokenAddress, signer);
    const tokenName = await token.name();
    const tokenDecimals = Number(await token.decimals());

    initAndStageInputParams.push({
      aTokenImpl: aTokenImplAddress,
      stableDebtTokenImpl: stableDebtTokenImplAddress,
      variableDebtTokenImpl: variableDebtTokenImplAddress,
      underlyingAssetDecimals: tokenDecimals,
      interestRateStrategyAddress: strategyDeployment.address,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress,
      aTokenName: `dLEND ${tokenName}`,
      aTokenSymbol: `dLEND-${symbol}`,
      variableDebtTokenName: `dLEND Variable Debt ${symbol}`,
      variableDebtTokenSymbol: `dLEND-variableDebt-${symbol}`,
      stableDebtTokenName: `dLEND Stable Debt ${symbol}`,
      stableDebtTokenSymbol: `dLEND-stableDebt-${symbol}`,
      params: "0x10",
      reserveFactor,
      supplyCap,
      debtCeiling,
    });
  }

  for (const initChunk of chunkArray(initAndStageInputParams, 3)) {
    const data = atomicHelper.interface.encodeFunctionData("initAndStageReserves", [poolAddress, poolConfiguratorAddress, initChunk]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: atomicHelperAddress, value: "0", data }),
    );
  }

  for (const stageChunk of chunkArray(stageInputParams, 5)) {
    const data = atomicHelper.interface.encodeFunctionData("stageReserves", [poolAddress, poolConfiguratorAddress, stageChunk]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: atomicHelperAddress, value: "0", data }),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND collateral reserve init + stage rollout (batch 2/2)");

  if (!success) {
    throw new Error("Failed to create Safe batch for collateral reserve init + stage rollout (batch 2/2).");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  ATOMIC_MARKET_LISTING_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe-v4";

export default func;
