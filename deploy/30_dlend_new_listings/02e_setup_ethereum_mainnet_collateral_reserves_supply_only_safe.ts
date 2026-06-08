import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  assertReserveOracleReadiness,
  buildExpectedOracleAssets,
  getDecodedReserveConfig,
  normalize,
  normalizeSymbol,
  parseBooleanEnv,
  parseStringArrayEnv,
  resolveTokenAddress,
  ROLLOUT_COLLATERAL_SYMBOLS,
} from "./common";

const DEFAULT_SUPPLY_ONLY_SYMBOLS = ["WETH", "wstETH", "syrupUSDC"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-supply-only-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("SUPPLY_ONLY_ENABLE_ACK", false)) {
    throw new Error(
      "Set SUPPLY_ONLY_ENABLE_ACK=true only when the selected reserves should be opened for supply while remaining non-collateral.",
    );
  }

  if (!parseBooleanEnv("SUPPLY_ONLY_MONITORING_ACK", false)) {
    throw new Error("Set SUPPLY_ONLY_MONITORING_ACK=true only after monitoring/alerting is live for the supply-only window.");
  }

  const requestedSymbolsRaw = parseStringArrayEnv("SUPPLY_ONLY_SYMBOLS_JSON");
  const requestedSymbols = requestedSymbolsRaw.length > 0 ? requestedSymbolsRaw : [...DEFAULT_SUPPLY_ONLY_SYMBOLS];
  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const configuredSymbolsByNormalized = new Map(rolloutSymbols.map((symbol) => [normalizeSymbol(symbol), symbol] as const));
  const selectedSymbols = requestedSymbols.map((requestedSymbol) => {
    const resolved = configuredSymbolsByNormalized.get(normalizeSymbol(requestedSymbol));

    if (!resolved) {
      throw new Error(
        [
          `[config-check] ${requestedSymbol} is not part of the supported collateral rollout set.`,
          `Allowed symbols: ${rolloutSymbols.join(", ")}`,
        ].join(" "),
      );
    }

    return resolved;
  });

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for supply-only reserve rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;
  const [isPoolAdmin, isRiskAdmin, isEmergencyAdmin] = await Promise.all([
    aclManager.isPoolAdmin(managerAddress),
    aclManager.isRiskAdmin(managerAddress),
    aclManager.isEmergencyAdmin(managerAddress),
  ]);

  if (!isPoolAdmin && !isRiskAdmin) {
    throw new Error(
      [
        `[role-check] ${managerAddress} must be POOL_ADMIN or RISK_ADMIN to open reserves for supply-only use.`,
        `aclManager=${aclManagerAddress}`,
      ].join(" "),
    );
  }

  if (!isPoolAdmin && !isEmergencyAdmin) {
    throw new Error(
      [`[role-check] ${managerAddress} must be POOL_ADMIN or EMERGENCY_ADMIN to unpause reserves.`, `aclManager=${aclManagerAddress}`].join(
        " ",
      ),
    );
  }

  const verifiedOracleAssets = new Set<string>();
  const expectedOracleAssets = buildExpectedOracleAssets(config);

  let queuedOperations = 0;

  for (const symbol of selectedSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams) {
      continue;
    }

    if (!tokenAddress) {
      throw new Error(
        `[config-check] Missing token address for ${symbol}. Run preflight and fix the network config before supply-only open.`,
      );
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

    if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
      throw new Error(
        [
          `[reserve-check] ${symbol} is not initialized on-chain yet.`,
          "Execute the init+stage Safe batch first, wait for it to be mined, then rerun the supply-only step.",
        ].join(" "),
      );
    }

    const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);
    const aToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", reserveData.aTokenAddress, signer);
    const aTokenSupply = await aToken.totalSupply();
    const targetReserveFactor = BigInt(reserveParams.reserveFactor);
    const targetSupplyCap = BigInt(reserveParams.supplyCap);
    const targetDebtCeiling = BigInt(reserveParams.debtCeiling);

    if (!currentConfig.active) {
      throw new Error(`[supply-only-check] Reserve ${symbol} is inactive; manual review is required before opening supply.`);
    }

    if (aTokenSupply > 0n && currentConfig.ltv !== 0n) {
      console.log(
        [
          `ℹ️ ${symbol}: existing suppliers prevent fully disabling collateral parameters.`,
          "Flooring LTV to 0 while preserving liquidation threshold/bonus.",
          `aTokenSupply=${aTokenSupply.toString()}`,
          `liqThreshold=${currentConfig.liquidationThreshold.toString()}`,
          `liqBonus=${currentConfig.liquidationBonus.toString()}`,
        ].join(" "),
      );
      const data = poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [
        tokenAddress,
        0,
        currentConfig.liquidationThreshold,
        currentConfig.liquidationBonus,
      ]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (
      aTokenSupply === 0n &&
      (currentConfig.ltv !== 0n || currentConfig.liquidationThreshold !== 0n || currentConfig.liquidationBonus !== 0n)
    ) {
      const data = poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [tokenAddress, 0, 0, 0]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.stableBorrowingEnabled) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.borrowingEnabled) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.flashLoanEnabled) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.borrowCap !== 0n) {
      const data = poolConfigurator.interface.encodeFunctionData("setBorrowCap", [tokenAddress, 0]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.borrowableInIsolation) {
      const data = poolConfigurator.interface.encodeFunctionData("setBorrowableInIsolation", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.paused) {
      const data = poolConfigurator.interface.encodeFunctionData("setReservePause", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.frozen) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [tokenAddress, false]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.reserveFactor !== targetReserveFactor) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveFactor", [tokenAddress, targetReserveFactor]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.supplyCap !== targetSupplyCap) {
      const data = poolConfigurator.interface.encodeFunctionData("setSupplyCap", [tokenAddress, targetSupplyCap]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }

    if (currentConfig.debtCeiling !== targetDebtCeiling) {
      const data = poolConfigurator.interface.encodeFunctionData("setDebtCeiling", [tokenAddress, targetDebtCeiling]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
    }
  }

  if (queuedOperations === 0) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-supply-only-safe: selected reserves already supply-only open");
    return true;
  }

  const success = await executor.flush("Ethereum mainnet dLEND supply-only reserve open");

  if (!success) {
    throw new Error("Failed to create Safe batch for supply-only reserve open.");
  }

  console.log(`🔁 setup-ethereum-mainnet-collateral-reserves-supply-only-safe: ✅ (${queuedOperations} operations)`);
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-supply-only-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-supply-only-safe-v1";

export default func;
