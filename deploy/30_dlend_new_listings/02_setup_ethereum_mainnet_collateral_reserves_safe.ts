import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { assertRoleGrantedToManager, getRoleAccess } from "../_shared/safe-role";

const ROLLOUT_COLLATERAL_SYMBOLS = [
  "WETH",
  "wstETH",
  "rETH",
  "sfrxETH",
  "sUSDe",
  "sUSDS",
  "syrupUSDC",
  "syrupUSDT",
  "sfrxUSD",
  "LBTC",
  "WBTC",
  "cbBTC",
  "PAXG",
] as const;

const INIT_BATCH_ONE_SYMBOLS = ROLLOUT_COLLATERAL_SYMBOLS.slice(0, 7);

/**
 * Splits a list into smaller chunks.
 *
 * @param items Source list to split.
 * @param size Chunk size.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

/**
 * Normalizes an address value for case-insensitive comparisons.
 *
 * @param value Address to normalize.
 */
function normalize(value: string): string {
  return value.toLowerCase();
}

/**
 * Resolves token addresses from config first, then from deployments as fallback.
 *
 * @param hre Hardhat runtime used for deployment lookups.
 * @param symbol Token symbol to resolve.
 * @param tokenMap Token address map from config.
 */
async function resolveTokenAddress(
  hre: HardhatRuntimeEnvironment,
  symbol: string,
  tokenMap: Record<string, string>,
): Promise<string | null> {
  const fromConfig = tokenMap[symbol];

  if (fromConfig) {
    return fromConfig;
  }

  const fallback = await hre.deployments.getOrNull(symbol);
  return fallback?.address ?? null;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-safe: local network detected – skipping");
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
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;
  const [poolAdminRole, assetListingAdminRole] = await Promise.all([aclManager.POOL_ADMIN_ROLE(), aclManager.ASSET_LISTING_ADMIN_ROLE()]);

  const [poolAdminAccess, hasAssetListingAdmin] = await Promise.all([
    getRoleAccess(aclManager, poolAdminRole, managerAddress),
    aclManager.hasRole(assetListingAdminRole, managerAddress),
  ]);

  if (!poolAdminAccess.hasRole && !hasAssetListingAdmin) {
    await assertRoleGrantedToManager({
      contract: aclManager,
      contractAddress: aclManagerAddress,
      managerAddress,
      role: poolAdminRole,
      roleLabel: "POOL_ADMIN_ROLE",
      contractLabel: "ACLManager",
    });
  }

  const { address: treasuryAddress } = await deployments.get(TREASURY_PROXY_ID);
  const { address: aTokenImplAddress } = await deployments.get(ATOKEN_IMPL_ID);
  const { address: stableDebtTokenImplAddress } = await deployments.get(STABLE_DEBT_TOKEN_IMPL_ID);
  const { address: variableDebtTokenImplAddress } = await deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID);

  const rolloutSymbols = INIT_BATCH_ONE_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const verifiedOracleAssets = new Set<string>();
  const expectedOracleAssets = new Set<string>();

  for (const asset of Object.keys(config.oracleAggregators.USD.redstoneOracleAssets.plainRedstoneOracleWrappers ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.USD.redstoneOracleAssets.redstoneOracleWrappersWithThresholding ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const [asset, compositeConfig] of Object.entries(
    config.oracleAggregators.USD.redstoneOracleAssets.compositeRedstoneOracleWrappersWithThresholding ?? {},
  )) {
    expectedOracleAssets.add(normalize(asset));
    expectedOracleAssets.add(normalize(compositeConfig.feedAsset));
  }

  for (const asset of Object.keys(config.oracleAggregators.USD.chainlinkErc4626OracleAssets ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.ETH.redstoneOracleAssets.plainRedstoneOracleWrappers ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.ETH.erc4626OracleAssets ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  if (config.oracleAggregators.ETH.frxEthFundamentalOracle?.asset) {
    expectedOracleAssets.add(normalize(config.oracleAggregators.ETH.frxEthFundamentalOracle.asset));
  }

  const assertReserveOracleReadiness = async (symbol: string, asset: string): Promise<void> => {
    const normalizedAsset = normalize(asset);

    if (verifiedOracleAssets.has(normalizedAsset)) {
      return;
    }

    const assetSource = await priceOracle.getSourceOfAsset(asset);

    if (normalize(assetSource) === normalize(ZeroAddress)) {
      throw new Error(
        [`[oracle-check] Missing price source for reserve ${symbol}.`, `asset=${asset}`, `oracle=${priceOracleAddress}`].join(" "),
      );
    }

    const oracleAggregator = await ethers.getContractAt(["function assetOracles(address) view returns (address)"], assetSource, signer);
    const mappedWrapper = await oracleAggregator.assetOracles(asset);

    if (normalize(mappedWrapper) === normalize(ZeroAddress)) {
      if (!expectedOracleAssets.has(normalizedAsset)) {
        throw new Error(
          [
            `[oracle-check] Asset ${symbol} has no oracle wrapper configured in source aggregator.`,
            `asset=${asset}`,
            `source=${assetSource}`,
            "Missing oracle rollout config entry for this reserve.",
          ].join(" "),
        );
      }

      // The wrapper may be queued in an earlier Safe batch in the same rollout run.
      verifiedOracleAssets.add(normalizedAsset);
      return;
    }

    let assetPrice: bigint;

    try {
      assetPrice = await priceOracle.getAssetPrice(asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        [
          `[oracle-check] Price lookup reverted for reserve ${symbol}.`,
          `asset=${asset}`,
          `wrapper=${mappedWrapper}`,
          `source=${assetSource}`,
          `reason=${message.split("\n")[0]}`,
        ].join(" "),
      );
    }

    if (assetPrice <= 0n) {
      throw new Error(
        [
          `[oracle-check] Non-positive price for reserve ${symbol}.`,
          `asset=${asset}`,
          `wrapper=${mappedWrapper}`,
          `source=${assetSource}`,
          `price=${assetPrice.toString()}`,
        ].join(" "),
      );
    }

    verifiedOracleAssets.add(normalizedAsset);
  };

  const initInputParams: Array<Record<string, unknown>> = [];

  for (const symbol of rolloutSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams || !tokenAddress) {
      continue;
    }

    const reserveData = await pool.getReserveData(tokenAddress);
    const alreadyInitialized = normalize(reserveData.aTokenAddress) !== normalize(ZeroAddress);

    if (alreadyInitialized) {
      continue;
    }

    await assertReserveOracleReadiness(symbol, tokenAddress);

    const strategyDeployment = await deployments.get(`ReserveStrategy-${reserveParams.strategy.name}`);
    const token = await ethers.getContractAt("IERC20Detailed", tokenAddress, signer);
    const tokenName = await token.name();
    const tokenDecimals = Number(await token.decimals());

    initInputParams.push({
      aTokenImpl: aTokenImplAddress,
      stableDebtTokenImpl: stableDebtTokenImplAddress,
      variableDebtTokenImpl: variableDebtTokenImplAddress,
      underlyingAssetDecimals: tokenDecimals,
      interestRateStrategyAddress: strategyDeployment.address,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress,
      underlyingAssetName: tokenName,
      aTokenName: `dLEND ${tokenName}`,
      aTokenSymbol: `dLEND-${symbol}`,
      variableDebtTokenName: `dLEND Variable Debt ${symbol}`,
      variableDebtTokenSymbol: `dLEND-variableDebt-${symbol}`,
      stableDebtTokenName: `dLEND Stable Debt ${symbol}`,
      stableDebtTokenSymbol: `dLEND-stableDebt-${symbol}`,
      params: "0x10",
    });
  }

  for (const initChunk of chunkArray(initInputParams, 3)) {
    const data = poolConfigurator.interface.encodeFunctionData("initReserves", [initChunk]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: poolConfiguratorAddress, value: "0", data }),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND collateral reserve init rollout (batch 1/2)");

  if (!success) {
    throw new Error("Failed to create Safe batch for collateral reserve init rollout (batch 1/2).");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-safe-v6";

export default func;
