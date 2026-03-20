import { getAddress, Interface } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { DEFAULT_CBBTC, normalizeAddress, parseAddressListEnv, parseBooleanEnv, queueSafeCall } from "./common";
import { REMEDIATION_POOL_IMPL_ID, SANITIZABLE_ATOKEN_IMPL_ID } from "./remediation_ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 ethereum-mainnet-cbbtc-sanitize-safe: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for cbBTC sanitize batch generation.");
  }

  await executor.initialize();

  if (!parseBooleanEnv("CBBTC_SANITIZE_ACK", false)) {
    throw new Error(
      "Set CBBTC_SANITIZE_ACK=true after reading docs/ethereum-mainnet-dlend-recovery-playbook.md (cbBTC sanitize / delist section).",
    );
  }

  const skipPoolUpgrade = parseBooleanEnv("REMEDIATION_SKIP_POOL_UPGRADE", false);
  const skipDeactivate = parseBooleanEnv("CBBTC_SANITIZE_SKIP_DEACTIVATE", false);
  const skipDropReserve = parseBooleanEnv("CBBTC_SANITIZE_SKIP_DROP_RESERVE", false);
  const cbBtcAddress = getAddress(process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC);
  const holders = parseAddressListEnv("CBBTC_SANITIZE_HOLDERS_JSON").map((a) => getAddress(a));
  const recoveryWallet = process.env.CBBTC_SANITIZE_RECOVERY_WALLET;

  if (!recoveryWallet) {
    throw new Error("Set CBBTC_SANITIZE_RECOVERY_WALLET to the address that receives rescued cbBTC underlying.");
  }
  const recoveryAddress = getAddress(recoveryWallet);

  const poolImplAddress =
    process.env.REMEDIATION_POOL_IMPL_ADDRESS || (skipPoolUpgrade ? undefined : (await deployments.get(REMEDIATION_POOL_IMPL_ID)).address);

  if (!skipPoolUpgrade && !poolImplAddress) {
    throw new Error("Could not resolve pool implementation address. Deploy remediation impls or set REMEDIATION_POOL_IMPL_ADDRESS.");
  }

  const sanitizableImplAddress = process.env.SANITIZABLE_ATOKEN_IMPL_ADDRESS || (await deployments.get(SANITIZABLE_ATOKEN_IMPL_ID)).address;

  const providerDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const configuratorDeployment = await deployments.get(POOL_CONFIGURATOR_PROXY_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", providerDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);

  if (normalizeAddress(poolConfiguratorAddress) !== normalizeAddress(configuratorDeployment.address)) {
    throw new Error(`PoolConfigurator proxy mismatch: ${poolConfiguratorAddress} vs deployment ${configuratorDeployment.address}`);
  }

  const [pool, poolConfigurator] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer),
  ]);

  if (!skipPoolUpgrade && poolImplAddress) {
    await queueSafeCall(
      executor,
      providerDeployment.address,
      addressProvider.interface.encodeFunctionData("setPoolImpl", [poolImplAddress]),
    );
  }

  await queueSafeCall(executor, poolAddress, pool.interface.encodeFunctionData("mintToTreasury", [[cbBtcAddress]]));

  const reserveData = await pool.getReserveData(cbBtcAddress);
  const aTokenAddress = reserveData.aTokenAddress;

  const aToken = await ethers.getContractAt(
    [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function RESERVE_TREASURY_ADDRESS() view returns (address)",
      "function getIncentivesController() view returns (address)",
    ],
    aTokenAddress,
    signer,
  );

  const [aName, aSymbol, treasuryRaw, incentivesControllerRaw] = await Promise.all([
    aToken.name(),
    aToken.symbol(),
    aToken.RESERVE_TREASURY_ADDRESS(),
    aToken.getIncentivesController(),
  ]);

  const treasury = getAddress(treasuryRaw as string);
  const incentivesController = getAddress(incentivesControllerRaw as string);

  await queueSafeCall(
    executor,
    poolConfiguratorAddress,
    poolConfigurator.interface.encodeFunctionData("updateAToken", [
      {
        asset: cbBtcAddress,
        treasury,
        incentivesController,
        name: aName,
        symbol: aSymbol,
        implementation: getAddress(sanitizableImplAddress),
        params: "0x",
      },
    ]),
  );

  const sanitizableArtifact = await hre.artifacts.readArtifact("SanitizableAToken");
  const sanitizableIface = new Interface(sanitizableArtifact.abi);
  await queueSafeCall(executor, aTokenAddress, sanitizableIface.encodeFunctionData("forceBurnAllAndVerifyZero", [holders]));

  await queueSafeCall(executor, aTokenAddress, sanitizableIface.encodeFunctionData("rescueAllUnderlying", [recoveryAddress]));

  if (!skipDeactivate) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveActive", [cbBtcAddress, false]),
    );
  }

  if (!skipDropReserve) {
    await queueSafeCall(executor, poolConfiguratorAddress, poolConfigurator.interface.encodeFunctionData("dropReserve", [cbBtcAddress]));
  }

  const success = await executor.flush(
    "Ethereum mainnet cbBTC sanitize: Pool upgrade (optional), mintToTreasury, SanitizableAToken upgrade, burn, rescue, drop",
  );

  if (!success) {
    throw new Error("Failed to flush cbBTC sanitize Safe batch");
  }

  console.log("🔁 ethereum-mainnet-cbbtc-sanitize-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "ethereum-mainnet-cbbtc-sanitize-safe", "dlend", "recovery", "cbbtc-sanitize"];
func.dependencies = ["ethereum-mainnet-cbbtc-sanitize-preflight"];
func.id = "ethereum-mainnet-cbbtc-sanitize-safe";

export default func;
