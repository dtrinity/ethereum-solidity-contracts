import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, RESERVES_SETUP_HELPER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

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
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-config-safe: local network detected – skipping");
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
    throw new Error("Safe config is required for collateral reserve config rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const pool = await ethers.getContractAt("Pool", await addressProvider.getPool(), signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;

  const reservesSetupHelperDeployment = await deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelperAddress = reservesSetupHelperDeployment.address;
  const reservesSetupHelper = await ethers.getContractAt("ReservesSetupHelper", reservesSetupHelperAddress, signer);
  const reservesSetupHelperOwner = await reservesSetupHelper.owner();

  if (normalize(reservesSetupHelperOwner) !== normalize(managerAddress)) {
    throw new Error(
      [
        `[reserve-check] ReservesSetupHelper owner mismatch.`,
        `helper=${reservesSetupHelperAddress}`,
        `owner=${reservesSetupHelperOwner}`,
        `expected=${managerAddress}.`,
        "Transfer helper ownership to the governance Safe before running collateral reserve config rollout.",
      ].join(" "),
    );
  }

  const riskAdminRole = await aclManager.RISK_ADMIN_ROLE();
  const helperHasRiskAdmin = await aclManager.hasRole(riskAdminRole, reservesSetupHelperAddress);

  if (!helperHasRiskAdmin) {
    throw new Error(
      [
        `[role-check] ReservesSetupHelper is missing RISK_ADMIN_ROLE.`,
        `helper=${reservesSetupHelperAddress}`,
        `aclManager=${aclManagerAddress}`,
        "Run and execute setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe before generating reserve config batch.",
      ].join(" "),
    );
  }

  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
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

      throw new Error(
        [
          `[oracle-check] Asset ${symbol} wrapper is still missing from the source aggregator.`,
          `asset=${asset}`,
          `source=${assetSource}`,
          "Execute the oracle rollout Safe batches before generating reserve config batch.",
        ].join(" "),
      );
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

  const reserveConfigInputParams: Array<Record<string, unknown>> = [];
  const uninitializedSymbols: string[] = [];

  for (const symbol of rolloutSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams || !tokenAddress) {
      continue;
    }

    const reserveData = await pool.getReserveData(tokenAddress);
    const initializedOnChain = normalize(reserveData.aTokenAddress) !== normalize(ZeroAddress);

    if (!initializedOnChain) {
      uninitializedSymbols.push(symbol);
      continue;
    }

    await assertReserveOracleReadiness(symbol, tokenAddress);

    reserveConfigInputParams.push({
      asset: tokenAddress,
      baseLTV: reserveParams.baseLTVAsCollateral,
      liquidationThreshold: reserveParams.liquidationThreshold,
      liquidationBonus: reserveParams.liquidationBonus,
      reserveFactor: reserveParams.reserveFactor,
      borrowCap: reserveParams.borrowCap,
      supplyCap: reserveParams.supplyCap,
      stableBorrowingEnabled: reserveParams.stableBorrowRateEnabled,
      borrowingEnabled: reserveParams.borrowingEnabled,
      flashLoanEnabled: reserveParams.flashLoanEnabled,
    });
  }

  if (uninitializedSymbols.length > 0) {
    throw new Error(
      [
        `[reserve-check] Some collateral reserves are not initialized on-chain yet: ${uninitializedSymbols.join(", ")}.`,
        "Execute setup-ethereum-mainnet-collateral-reserves-safe first, wait for it to be mined, then rerun this config step.",
      ].join(" "),
    );
  }

  if (reserveConfigInputParams.length > 0) {
    const configureReservesData = reservesSetupHelper.interface.encodeFunctionData("configureReserves", [
      poolConfiguratorAddress,
      reserveConfigInputParams,
    ]);

    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: reservesSetupHelperAddress, value: "0", data: configureReservesData }),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND collateral reserve config rollout");

  if (!success) {
    throw new Error("Failed to create Safe batch for collateral reserve config rollout.");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-config-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-config-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-safe",
  "setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe",
  "setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-config-safe-v4";

export default func;
