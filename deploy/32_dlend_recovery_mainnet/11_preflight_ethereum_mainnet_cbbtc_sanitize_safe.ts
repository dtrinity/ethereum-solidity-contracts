import { getAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { addBlocker, DEFAULT_CBBTC, getReserveConfig, normalizeAddress, parseAddressListEnv, parseBooleanEnv } from "./common";
import { REMEDIATION_POOL_IMPL_ID, SANITIZABLE_ATOKEN_IMPL_ID } from "./remediation_ids";

const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
const EIP1967_IMPLEMENTATION_SLOT = "0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";
const RAY = 10n ** 27n;
const ERC20_MIN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 ethereum-mainnet-cbbtc-sanitize-preflight: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);
  const blockers: string[] = [];

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required. Provide config.safeConfig and USE_SAFE flow for mainnet.");
  }

  const safeAddress = getAddress(config.safeConfig.safeAddress);
  const skipPoolUpgrade = parseBooleanEnv("REMEDIATION_SKIP_POOL_UPGRADE", false);
  const requireAttackerDebtZero = parseBooleanEnv("CBBTC_SANITIZE_REQUIRE_ATTACKER_DEBT_ZERO", true);
  const validateHolders = parseBooleanEnv("CBBTC_SANITIZE_VALIDATE_HOLDER_SUM", true);
  const attacker = process.env.ATTACKER || DEFAULT_ATTACKER;
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = getAddress(process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC);
  const holderCandidates = parseAddressListEnv("CBBTC_SANITIZE_HOLDERS_JSON");

  const [providerDeployment, configuratorDeployment] = await Promise.all([
    deployments.get(POOL_ADDRESSES_PROVIDER_ID),
    deployments.get(POOL_CONFIGURATOR_PROXY_ID),
  ]);

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", providerDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress, aclManagerAddress, owner] = await Promise.all([
    addressProvider.getPool(),
    addressProvider.getPoolConfigurator(),
    addressProvider.getACLManager(),
    addressProvider.owner(),
  ]);

  if (normalizeAddress(poolConfiguratorAddress) !== normalizeAddress(configuratorDeployment.address)) {
    addBlocker(
      blockers,
      `PoolConfiguratorProxy mismatch: provider=${poolConfiguratorAddress}, deployment=${configuratorDeployment.address}.`,
    );
  }

  if (!skipPoolUpgrade && normalizeAddress(owner) !== normalizeAddress(safeAddress)) {
    addBlocker(
      blockers,
      `PoolAddressesProvider owner ${owner} must equal Safe ${safeAddress} to call setPoolImpl (set REMEDIATION_SKIP_POOL_UPGRADE=true if Pool is already patched).`,
    );
  }

  const [pool, aclManager] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("ACLManager", aclManagerAddress, signer),
  ]);

  if (!(await aclManager.isPoolAdmin(safeAddress))) {
    addBlocker(blockers, `Safe ${safeAddress} must be pool admin for configurator and SanitizableAToken admin calls.`);
  }

  let expectedPoolImplAddress: string | undefined;

  try {
    expectedPoolImplAddress = getAddress(process.env.REMEDIATION_POOL_IMPL_ADDRESS || (await deployments.get(REMEDIATION_POOL_IMPL_ID)).address);
  } catch {
    if (skipPoolUpgrade) {
      addBlocker(
        blockers,
        `REMEDIATION_SKIP_POOL_UPGRADE=true requires the expected patched Pool implementation (${REMEDIATION_POOL_IMPL_ID}) to be deployed or REMEDIATION_POOL_IMPL_ADDRESS to be set.`,
      );
    } else {
      addBlocker(
        blockers,
        `Missing deployment artifact ${REMEDIATION_POOL_IMPL_ID}. Run tag ethereum-mainnet-dlend-remediation-impls first (or set REMEDIATION_POOL_IMPL_ADDRESS only for batch generation after manual deploy).`,
      );
    }
  }

  if (!skipPoolUpgrade && !expectedPoolImplAddress) {
    addBlocker(
      blockers,
      `Could not resolve the expected patched Pool implementation. Deploy ${REMEDIATION_POOL_IMPL_ID} or set REMEDIATION_POOL_IMPL_ADDRESS.`,
    );
  }

  if (!skipPoolUpgrade) {
    try {
      const currentPoolImplStorage = await ethers.provider.getStorage(poolAddress, EIP1967_IMPLEMENTATION_SLOT);
      const currentPoolImpl = getAddress(`0x${currentPoolImplStorage.slice(-40)}`);
      console.log(`Pool proxy implementation: current=${currentPoolImpl} expected=${expectedPoolImplAddress ?? "unknown"}`);
    } catch (error) {
      addBlocker(blockers, `Unable to read current Pool proxy implementation from ${poolAddress}: ${String(error)}.`);
    }
  } else if (expectedPoolImplAddress) {
    try {
      const currentPoolImplStorage = await ethers.provider.getStorage(poolAddress, EIP1967_IMPLEMENTATION_SLOT);
      const currentPoolImpl = getAddress(`0x${currentPoolImplStorage.slice(-40)}`);

      if (normalizeAddress(currentPoolImpl) !== normalizeAddress(expectedPoolImplAddress)) {
        addBlocker(
          blockers,
          `REMEDIATION_SKIP_POOL_UPGRADE=true but Pool proxy ${poolAddress} points to ${currentPoolImpl}, not patched impl ${expectedPoolImplAddress}.`,
        );
      }
    } catch (error) {
      addBlocker(blockers, `Unable to read current Pool proxy implementation from ${poolAddress}: ${String(error)}.`);
    }
  }

  try {
    await deployments.get(SANITIZABLE_ATOKEN_IMPL_ID);
  } catch {
    addBlocker(
      blockers,
      `Missing deployment artifact ${SANITIZABLE_ATOKEN_IMPL_ID}. Run tag ethereum-mainnet-dlend-remediation-impls first.`,
    );
  }

  const reserveCfg = await getReserveConfig(pool, cbBtcAddress);

  if (!reserveCfg.paused) {
    addBlocker(blockers, "cbBTC reserve must be paused.");
  }

  if (!reserveCfg.frozen) {
    addBlocker(blockers, "cbBTC reserve must be frozen.");
  }

  if (reserveCfg.borrowingEnabled) {
    addBlocker(blockers, "cbBTC borrowing must be disabled.");
  }

  if (reserveCfg.stableRateBorrowingEnabled) {
    addBlocker(blockers, "cbBTC stable borrowing must be disabled.");
  }

  if (reserveCfg.flashLoanEnabled) {
    addBlocker(blockers, "cbBTC flash loans must be disabled.");
  }

  const reserveData = await pool.getReserveData(cbBtcAddress);
  const stableDebt = await ethers.getContractAt(ERC20_MIN_ABI, reserveData.stableDebtTokenAddress, signer);
  const variableDebt = await ethers.getContractAt(ERC20_MIN_ABI, reserveData.variableDebtTokenAddress, signer);
  const [stableSupply, variableSupply] = await Promise.all([stableDebt.totalSupply(), variableDebt.totalSupply()]);

  if (stableSupply !== 0n) {
    addBlocker(blockers, `cbBTC stable debt supply must be zero (got ${stableSupply}).`);
  }

  if (variableSupply !== 0n) {
    addBlocker(blockers, `cbBTC variable debt supply must be zero (got ${variableSupply}).`);
  }

  if (requireAttackerDebtZero && dUSDAddress) {
    const dusdReserveData = await pool.getReserveData(dUSDAddress);
    const dusdDebtToken = await ethers.getContractAt(ERC20_MIN_ABI, dusdReserveData.variableDebtTokenAddress, signer);
    const attackerDebt = await dusdDebtToken.balanceOf(attacker);

    if (attackerDebt !== 0n) {
      addBlocker(
        blockers,
        `Attacker dUSD variable debt is nonzero (${attackerDebt.toString()}). Repay before cbBTC sanitize (set CBBTC_SANITIZE_REQUIRE_ATTACKER_DEBT_ZERO=false to override).`,
      );
    }
  }

  const aTokenAddress = reserveData.aTokenAddress;
  const aToken = await ethers.getContractAt(
    [
      "function totalSupply() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function scaledTotalSupply() view returns (uint256)",
      "function scaledBalanceOf(address) view returns (uint256)",
      "function RESERVE_TREASURY_ADDRESS() view returns (address)",
    ],
    aTokenAddress,
    signer,
  );
  const [totalSupply, scaledTotalSupply, treasuryRaw, normalizedIncome] = await Promise.all([
    aToken.totalSupply(),
    aToken.scaledTotalSupply(),
    aToken.RESERVE_TREASURY_ADDRESS(),
    pool.getReserveNormalizedIncome(cbBtcAddress),
  ]);
  const treasury = getAddress(treasuryRaw as string);
  const currentTotalSupply = BigInt(totalSupply.toString());
  const currentScaledTotalSupply = BigInt(scaledTotalSupply.toString());
  const accruedToTreasuryScaled = BigInt(reserveData.accruedToTreasury.toString());
  const currentNormalizedIncome = BigInt(normalizedIncome.toString());
  const treasuryMintAmount = accruedToTreasuryScaled === 0n ? 0n : (accruedToTreasuryScaled * currentNormalizedIncome + RAY / 2n) / RAY;
  const expectedPostMintTotalSupply = currentTotalSupply + treasuryMintAmount;

  if (totalSupply > 0n && holderCandidates.length === 0) {
    addBlocker(
      blockers,
      "CBBTC_SANITIZE_HOLDERS_JSON must list every address with a non-zero aToken balance at execution time (see playbook).",
    );
  }

  if (treasuryMintAmount > 0n && !holderCandidates.some((holder) => normalizeAddress(holder) === normalizeAddress(treasury))) {
    addBlocker(
      blockers,
      `Treasury ${treasury} must be included in CBBTC_SANITIZE_HOLDERS_JSON because mintToTreasury([cbBTC]) will mint ${treasuryMintAmount.toString()} aTokens before burn.`,
    );
  }

  if (validateHolders && holderCandidates.length > 0 && expectedPostMintTotalSupply > 0n) {
    let scaledSum = 0n;
    const treasuryNormalized = normalizeAddress(treasury);

    for (const holder of holderCandidates) {
      scaledSum += await aToken.scaledBalanceOf(getAddress(holder));

      if (treasuryMintAmount > 0n && normalizeAddress(holder) === treasuryNormalized) {
        scaledSum += accruedToTreasuryScaled;
      }
    }

    const expectedScaledHolderSum = currentScaledTotalSupply + accruedToTreasuryScaled;

    if (scaledSum !== expectedScaledHolderSum) {
      addBlocker(
        blockers,
        `Holder set does not cover post-mint scaled supply: sum(scaledBalanceOf)+accruedToTreasury=${scaledSum.toString()} expected=${expectedScaledHolderSum.toString()}. Refresh CBBTC_SANITIZE_HOLDERS_JSON from Transfer logs and include treasury if mintToTreasury will materialize accrued fees.`,
      );
    }
  }

  console.log(
    `cbBTC aToken totalSupply(): current=${totalSupply.toString()} treasuryMint=${treasuryMintAmount.toString()} expectedAfterMintToTreasury=${expectedPostMintTotalSupply.toString()}`,
  );

  if (blockers.length > 0) {
    console.error("🔴 ethereum-mainnet-cbbtc-sanitize-preflight failed:");

    for (const line of blockers) {
      console.error(` - ${line}`);
    }
    throw new Error("ethereum-mainnet-cbbtc-sanitize-preflight: fix blockers before preparing the Safe batch");
  }

  console.log("🔁 ethereum-mainnet-cbbtc-sanitize-preflight: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "ethereum-mainnet-cbbtc-sanitize-preflight", "dlend", "recovery", "cbbtc-sanitize"];
func.id = "ethereum-mainnet-cbbtc-sanitize-preflight";

export default func;
