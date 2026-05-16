import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { JsonRpcProvider } from "ethers";

export const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
export const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

type DeploymentArtifact = {
  address: string;
};

/**
 * Resolves the repo root relative to the current working directory.
 */
export function repoRoot(): string {
  return process.cwd();
}

/**
 * Loads an address from a hardhat-deploy artifact when available.
 *
 * @param deploymentName Deployment file name without extension.
 * @param fallback Fallback address when the artifact is missing.
 */
export function loadDeploymentAddress(deploymentName: string, fallback = ""): string {
  const deploymentPath = path.resolve(repoRoot(), "deployments", "ethereum_mainnet", `${deploymentName}.json`);

  if (!existsSync(deploymentPath)) {
    return fallback;
  }

  const parsed = JSON.parse(readFileSync(deploymentPath, "utf8")) as DeploymentArtifact;
  return parsed.address ?? fallback;
}

/**
 * Builds a provider from the environment, defaulting to the repo's mainnet RPC.
 */
export function createProvider(): JsonRpcProvider {
  return new JsonRpcProvider(process.env.RPC_URL || "https://ethereum-rpc.publicnode.com");
}

/**
 * Normalizes an address for case-insensitive comparisons.
 *
 * @param value Address to normalize.
 */
export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

/**
 * Removes duplicate addresses while preserving the original order.
 *
 * @param values Addresses to deduplicate.
 */
export function uniqueAddresses(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeAddress(value);

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    out.push(value);
  }

  return out;
}

/**
 * Loads and deduplicates an address list from the first defined env var.
 *
 * @param names Candidate env vars in precedence order.
 */
export function parseAddressListEnv(...names: string[]): string[] {
  for (const name of names) {
    const raw = process.env[name];

    if (!raw) {
      continue;
    }

    return uniqueAddresses(JSON.parse(raw) as string[]);
  }

  return [];
}

/**
 * Loads a boolean env var with a default fallback.
 *
 * @param name Env var name.
 * @param defaultValue Fallback when unset.
 */
export function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];

  if (!raw) {
    return defaultValue;
  }

  return raw.toLowerCase() === "true";
}

/**
 * Decodes a single bitfield slice.
 *
 * @param value Raw packed value.
 * @param start Start bit.
 * @param width Bit width.
 */
export function bit(value: bigint, start: bigint, width = 1n): bigint {
  return (value >> start) & ((1n << width) - 1n);
}

export type DecodedReserveConfig = {
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  decimals: number;
  active: boolean;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableRateBorrowingEnabled: boolean;
  paused: boolean;
  borrowableInIsolation: boolean;
  siloedBorrowing: boolean;
  flashLoanEnabled: boolean;
  reserveFactorBps: number;
  borrowCapWholeTokens: string;
  supplyCapWholeTokens: string;
};

/**
 * Decodes the reserve bitmap used by Aave-v3-style configs.
 *
 * @param data Raw config bitmap.
 */
export function decodeConfig(data: bigint): DecodedReserveConfig {
  return {
    ltv: Number(bit(data, 0n, 16n)),
    liquidationThreshold: Number(bit(data, 16n, 16n)),
    liquidationBonus: Number(bit(data, 32n, 16n)),
    decimals: Number(bit(data, 48n, 8n)),
    active: bit(data, 56n) === 1n,
    frozen: bit(data, 57n) === 1n,
    borrowingEnabled: bit(data, 58n) === 1n,
    stableRateBorrowingEnabled: bit(data, 59n) === 1n,
    paused: bit(data, 60n) === 1n,
    borrowableInIsolation: bit(data, 61n) === 1n,
    siloedBorrowing: bit(data, 62n) === 1n,
    flashLoanEnabled: bit(data, 63n) === 1n,
    reserveFactorBps: Number(bit(data, 64n, 16n)),
    borrowCapWholeTokens: bit(data, 80n, 36n).toString(),
    supplyCapWholeTokens: bit(data, 116n, 36n).toString(),
  };
}

export const poolAbi = [
  "function getConfiguration(address asset) view returns ((uint256 data))",
  "function getReserveData(address asset) view returns ((uint256 configurationData,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)",
  "function getReservesList() view returns (address[])",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
] as const;

export const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
] as const;

export const aTokenAbi = [
  ...erc20Abi,
  "function scaledTotalSupply() view returns (uint256)",
  "function scaledBalanceOf(address owner) view returns (uint256)",
] as const;

/**
 * Resolves the reserve list from env or on-chain state.
 */
export function parseReserveOverrides(): string[] {
  return parseAddressListEnv("RESERVES_JSON");
}
