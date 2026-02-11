import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const ROLLOUT_COLLATERAL_SYMBOLS = [
  "WETH",
  "wstETH",
  "rETH",
  "sfrxETH",
  "frxETH",
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
 * Splits a list into smaller chunks.
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
 */
function normalize(value: string): string {
  return value.toLowerCase();
}

/**
 * Resolves token addresses from config first, then from deployments as fallback.
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
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);

  const reservesSetupHelperDeployment = await deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelperAddress = reservesSetupHelperDeployment.address;
  const reservesSetupHelper = await ethers.getContractAt("ReservesSetupHelper", reservesSetupHelperAddress, signer);

  const { address: treasuryAddress } = await deployments.get(TREASURY_PROXY_ID);
  const { address: aTokenImplAddress } = await deployments.get(ATOKEN_IMPL_ID);
  const { address: stableDebtTokenImplAddress } = await deployments.get(STABLE_DEBT_TOKEN_IMPL_ID);
  const { address: variableDebtTokenImplAddress } = await deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID);

  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));

  const initInputParams: Array<Record<string, unknown>> = [];
  const symbolsQueuedForInit = new Set<string>();

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

    symbolsQueuedForInit.add(symbol);
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

  const reserveConfigInputParams: Array<Record<string, unknown>> = [];

  for (const symbol of rolloutSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams || !tokenAddress) {
      continue;
    }

    const reserveData = await pool.getReserveData(tokenAddress);
    const initializedOnChain = normalize(reserveData.aTokenAddress) !== normalize(ZeroAddress);

    if (!initializedOnChain && !symbolsQueuedForInit.has(symbol)) {
      continue;
    }

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

  if (reserveConfigInputParams.length > 0) {
    const grantRiskAdminData = aclManager.interface.encodeFunctionData("addRiskAdmin", [reservesSetupHelperAddress]);
    const configureReservesData = reservesSetupHelper.interface.encodeFunctionData("configureReserves", [
      poolConfiguratorAddress,
      reserveConfigInputParams,
    ]);
    const revokeRiskAdminData = aclManager.interface.encodeFunctionData("removeRiskAdmin", [reservesSetupHelperAddress]);

    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: grantRiskAdminData }),
    );

    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: reservesSetupHelperAddress, value: "0", data: configureReservesData }),
    );

    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: revokeRiskAdminData }),
    );
  }

  await executor.flush("Ethereum mainnet dLEND collateral reserve rollout");
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe"];
func.dependencies = [
  "dLend:init_reserves",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-safe";

export default func;
