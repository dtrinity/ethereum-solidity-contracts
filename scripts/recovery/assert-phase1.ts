import "dotenv/config";

import { Contract } from "ethers";

import {
  createProvider,
  decodeConfig,
  DEFAULT_CBBTC,
  loadDeploymentAddress,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
  poolAbi,
} from "./common";

const provider = createProvider();
const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const REQUIRE_CBBTC_LTV_ZERO = parseBooleanEnv("REQUIRE_CBBTC_LTV_ZERO", true);

if (!POOL || !DUSD || !CBBTC) {
  throw new Error("Missing required addresses. Set POOL, DUSD, and CBBTC.");
}

async function main() {
  const pool = new Contract(POOL, poolAbi, provider);
  const configuredReserves = parseAddressListEnv("PHASE1_RESERVES_JSON", "RESERVES_JSON", "RECOVERY_RESERVES_JSON");
  const reserves = configuredReserves.length > 0 ? configuredReserves : ((await pool.getReservesList()) as string[]);
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const asset of reserves) {
    const cfgRaw = await pool.getConfiguration(asset);
    const cfg = decodeConfig(BigInt(cfgRaw.data.toString()));
    const normalized = normalizeAddress(asset);

    if (!cfg.active) {
      failures.push(`reserve ${asset} is inactive`);
    }

    if (!cfg.frozen) {
      failures.push(`reserve ${asset} is not frozen`);
    }

    if (cfg.borrowingEnabled) {
      failures.push(`reserve ${asset} still has borrowing enabled`);
    }

    if (cfg.stableRateBorrowingEnabled) {
      failures.push(`reserve ${asset} still has stable-rate borrowing enabled`);
    }

    if (cfg.flashLoanEnabled) {
      failures.push(`reserve ${asset} still has flash loans enabled`);
    }

    if (normalized === normalizeAddress(DUSD)) {
      if (cfg.paused) {
        failures.push("dUSD is still paused");
      }
      continue;
    }

    if (!cfg.paused) {
      failures.push(`reserve ${asset} is unpaused even though only dUSD should be live after Phase 1`);
    }

    if (normalized === normalizeAddress(CBBTC) && REQUIRE_CBBTC_LTV_ZERO && cfg.ltv !== 0) {
      failures.push(`cbBTC LTV is ${cfg.ltv} instead of 0`);
    } else if (normalized === normalizeAddress(CBBTC) && cfg.ltv !== 0) {
      warnings.push(`cbBTC LTV remains ${cfg.ltv}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        failures,
        warnings,
        status: failures.length === 0 ? "PASS" : "FAIL",
      },
      null,
      2,
    ),
  );

  if (failures.length !== 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
