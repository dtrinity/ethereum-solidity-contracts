import "dotenv/config";

import { Contract, formatUnits, MaxUint256, Wallet } from "ethers";

import {
  createProvider,
  decodeConfig,
  DEFAULT_ATTACKER,
  DEFAULT_CBBTC,
  erc20Abi,
  loadDeploymentAddress,
  parseBooleanEnv,
  poolAbi,
} from "./common";

const provider = createProvider();
const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const ATTACKER = process.env.ATTACKER || DEFAULT_ATTACKER;
const VARIABLE_RATE_MODE = 2;
const DRY_RUN = parseBooleanEnv("DRY_RUN", false);

if (!process.env.PRIVATE_KEY || !POOL || !DUSD || !ATTACKER || !CBBTC) {
  throw new Error("Set PRIVATE_KEY and ensure POOL, DUSD, CBBTC, and ATTACKER are resolvable.");
}

async function main() {
  const pool = new Contract(POOL, poolAbi, signer);
  const [dusdConfigRaw, cbBtcConfigRaw] = await Promise.all([pool.getConfiguration(DUSD), pool.getConfiguration(CBBTC)]);
  const dusdConfig = decodeConfig(BigInt(dusdConfigRaw.data.toString()));
  const cbBtcConfig = decodeConfig(BigInt(cbBtcConfigRaw.data.toString()));

  if (dusdConfig.paused) {
    throw new Error("dUSD reserve is still paused. Repay will revert until paused=false.");
  }

  if (!dusdConfig.frozen) {
    throw new Error("dUSD reserve must be frozen before repay.");
  }

  if (dusdConfig.borrowingEnabled || dusdConfig.flashLoanEnabled) {
    throw new Error("dUSD reserve must have borrowing and flash loans disabled before repay.");
  }

  if (dusdConfig.stableRateBorrowingEnabled) {
    throw new Error("dUSD reserve must have stable-rate borrowing disabled before repay.");
  }

  if (!cbBtcConfig.paused) {
    throw new Error("cbBTC must remain paused during debt repayment.");
  }

  if (cbBtcConfig.borrowingEnabled || cbBtcConfig.flashLoanEnabled) {
    throw new Error("cbBTC must have borrowing and flash loans disabled during debt repayment.");
  }

  if (cbBtcConfig.stableRateBorrowingEnabled) {
    throw new Error("cbBTC must have stable-rate borrowing disabled during debt repayment.");
  }

  const dusdReserve = await pool.getReserveData(DUSD);
  const dusdDebtToken = new Contract(dusdReserve.variableDebtTokenAddress, erc20Abi, signer);
  const dusdToken = new Contract(DUSD, erc20Abi, signer);
  const payer = await signer.getAddress();
  const decimals = Number(await dusdToken.decimals());

  const [preDebt, allowance, payerBalance] = await Promise.all([
    dusdDebtToken.balanceOf(ATTACKER),
    dusdToken.allowance(payer, POOL),
    dusdToken.balanceOf(payer),
  ]);
  const balanceSufficient = payerBalance >= preDebt;

  console.log(
    JSON.stringify(
      {
        payer,
        pool: POOL,
        dUSD: DUSD,
        attacker: ATTACKER,
        variableRateMode: VARIABLE_RATE_MODE,
        preDebt: preDebt.toString(),
        preDebtFormatted: formatUnits(preDebt, decimals),
        payerBalance: payerBalance.toString(),
        payerBalanceFormatted: formatUnits(payerBalance, decimals),
        balanceSufficient,
        allowance: allowance.toString(),
        allowanceFormatted: formatUnits(allowance, decimals),
        dryRun: DRY_RUN,
      },
      null,
      2,
    ),
  );

  if (preDebt === 0n) {
    console.log("Attacker variable debt is already zero; nothing to repay.");
    return;
  }

  const repayAmount = MaxUint256 - 1n;

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          action: "dry-run",
          balanceSufficient,
          approvalRequired: allowance < preDebt,
          repayAmount: repayAmount.toString(),
          note: "Run again with DRY_RUN=false (or unset) to actually send transactions.",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!balanceSufficient) {
    throw new Error(
      `Payer dUSD balance (${formatUnits(payerBalance, decimals)}) is below attacker debt (${formatUnits(preDebt, decimals)}).`,
    );
  }

  if (allowance < preDebt) {
    const approveTx = await dusdToken.approve(POOL, MaxUint256);
    console.log(`Approve tx: ${approveTx.hash}`);
    await approveTx.wait();
  }

  const repayTx = await pool.repay(DUSD, repayAmount, VARIABLE_RATE_MODE, ATTACKER);
  console.log(`Repay tx: ${repayTx.hash}`);
  const receipt = await repayTx.wait();
  console.log(`Mined in block ${receipt?.blockNumber}`);

  const postDebt = await dusdDebtToken.balanceOf(ATTACKER);
  const attackerAccountData = await pool.getUserAccountData(ATTACKER);

  console.log(
    JSON.stringify(
      {
        payer,
        attacker: ATTACKER,
        preDebt: preDebt.toString(),
        postDebt: postDebt.toString(),
        accountDataAfter: {
          totalCollateralBase: attackerAccountData.totalCollateralBase.toString(),
          totalDebtBase: attackerAccountData.totalDebtBase.toString(),
          availableBorrowsBase: attackerAccountData.availableBorrowsBase.toString(),
          currentLiquidationThreshold: attackerAccountData.currentLiquidationThreshold.toString(),
          ltv: attackerAccountData.ltv.toString(),
          healthFactor: attackerAccountData.healthFactor.toString(),
        },
      },
      null,
      2,
    ),
  );

  if (postDebt !== 0n) {
    console.error("WARNING: attacker debt remains nonzero after repay.");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
