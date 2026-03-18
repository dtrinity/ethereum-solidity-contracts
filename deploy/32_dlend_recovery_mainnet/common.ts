import { Contract } from "ethers";

import { GovernanceExecutor } from "../../typescript/hardhat/governance";

export const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

export type DecodedReserveConfig = {
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint;
  active: boolean;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableRateBorrowingEnabled: boolean;
  paused: boolean;
  flashLoanEnabled: boolean;
};

/**
 * Adds a formatted blocker to the mutable blocker list.
 *
 * @param blockers Mutable blocker array.
 * @param message Message to append.
 */
export function addBlocker(blockers: string[], message: string): void {
  blockers.push(message);
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
 * Decodes a single slice from a packed reserve configuration bitmap.
 *
 * @param value Raw packed value.
 * @param start Start bit.
 * @param width Width in bits.
 */
export function bit(value: bigint, start: bigint, width = 1n): bigint {
  return (value >> start) & ((1n << width) - 1n);
}

/**
 * Converts the raw reserve bitmap into named fields.
 *
 * @param data Raw reserve config.
 */
export function decodeConfig(data: bigint): DecodedReserveConfig {
  return {
    ltv: bit(data, 0n, 16n),
    liquidationThreshold: bit(data, 16n, 16n),
    liquidationBonus: bit(data, 32n, 16n),
    active: bit(data, 56n) === 1n,
    frozen: bit(data, 57n) === 1n,
    borrowingEnabled: bit(data, 58n) === 1n,
    stableRateBorrowingEnabled: bit(data, 59n) === 1n,
    paused: bit(data, 60n) === 1n,
    flashLoanEnabled: bit(data, 63n) === 1n,
  };
}

/**
 * Loads and deduplicates an address list from the first defined env var.
 *
 * @param names Candidate env var names in precedence order.
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
 * Reads the active reserve list directly from the Pool.
 *
 * @param pool Pool contract.
 */
export async function getPoolReserves(pool: Contract): Promise<string[]> {
  return uniqueAddresses(
    ((await pool.getReservesList()) as string[]).filter((asset) => asset !== "0x0000000000000000000000000000000000000000"),
  );
}

/**
 * Loads and decodes the reserve config for a single asset.
 *
 * @param pool Pool contract.
 * @param asset Reserve asset.
 */
export async function getReserveConfig(pool: Contract, asset: string): Promise<DecodedReserveConfig> {
  const raw = await pool.getConfiguration(asset);
  return decodeConfig(BigInt(raw.data.toString()));
}

/**
 * Returns whether a subset is fully contained in a superset.
 *
 * @param subset Candidate subset.
 * @param superset Candidate superset.
 */
export function isSubset(subset: Iterable<string>, superset: Iterable<string>): boolean {
  const supersetValues = new Set(Array.from(superset, (value) => normalizeAddress(value)));

  for (const value of subset) {
    if (!supersetValues.has(normalizeAddress(value))) {
      return false;
    }
  }

  return true;
}

/**
 * Derives the default Phase 2 target set: every currently paused reserve except
 * dUSD and cbBTC.
 *
 * @param pool Pool contract.
 * @param dUSDAddress dUSD reserve address.
 * @param cbBtcAddress cbBTC reserve address.
 */
export async function getDefaultPhase2TargetReserves(pool: Contract, dUSDAddress: string, cbBtcAddress: string): Promise<string[]> {
  const reserves = await getPoolReserves(pool);
  const targets: string[] = [];

  for (const asset of reserves) {
    const normalized = normalizeAddress(asset);

    if (normalized === normalizeAddress(dUSDAddress) || normalized === normalizeAddress(cbBtcAddress)) {
      continue;
    }

    const config = await getReserveConfig(pool, asset);

    if (config.paused) {
      targets.push(asset);
    }
  }

  return targets;
}

/**
 * Queues a Safe call against the PoolConfigurator.
 *
 * @param executor Governance executor used to queue Safe txs.
 * @param to Target contract.
 * @param data Encoded calldata.
 */
export async function queueSafeCall(executor: GovernanceExecutor, to: string, data: string): Promise<void> {
  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to, value: "0", data }),
  );
}

/**
 * Queues the emergency transition for a reserve into frozen mode.
 *
 * Final state:
 * - stable borrowing disabled
 * - borrowing disabled
 * - flash loans disabled
 * - frozen enabled
 * - paused set to the requested final value
 *
 * @param executor Governance executor.
 * @param poolConfigurator PoolConfigurator contract.
 * @param poolConfiguratorAddress PoolConfigurator address.
 * @param asset Reserve asset.
 * @param current Current reserve config.
 * @param finalPaused Final paused state.
 */
export async function queueReserveIntoFrozenState(
  executor: GovernanceExecutor,
  poolConfigurator: Contract,
  poolConfiguratorAddress: string,
  asset: string,
  current: DecodedReserveConfig,
  finalPaused: boolean,
): Promise<void> {
  if (current.stableRateBorrowingEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [asset, false]),
    );
  }

  if (current.borrowingEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [asset, false]),
    );
  }

  if (current.flashLoanEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [asset, false]),
    );
  }

  if (!current.frozen) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [asset, true]),
    );
  }

  if (current.paused !== finalPaused) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReservePause", [asset, finalPaused]),
    );
  }
}

/**
 * Queues the target recovery-resume state for a reserve.
 *
 * Final state:
 * - reserve unpaused
 * - reserve unfrozen
 * - borrowing/stable borrowing/flash loans match the requested flags
 *
 * @param executor Governance executor.
 * @param poolConfigurator PoolConfigurator contract.
 * @param poolConfiguratorAddress PoolConfigurator address.
 * @param asset Reserve asset.
 * @param current Current reserve config.
 * @param desiredBorrowing Target borrowing flag.
 * @param desiredStableBorrowing Target stable-borrowing flag.
 * @param desiredFlashLoans Target flash-loan flag.
 */
export async function queueReserveIntoResumeState(
  executor: GovernanceExecutor,
  poolConfigurator: Contract,
  poolConfiguratorAddress: string,
  asset: string,
  current: DecodedReserveConfig,
  desiredBorrowing: boolean,
  desiredStableBorrowing: boolean,
  desiredFlashLoans: boolean,
): Promise<void> {
  if (current.stableRateBorrowingEnabled && !desiredStableBorrowing) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [asset, false]),
    );
  }

  if (current.borrowingEnabled && !desiredBorrowing) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [asset, false]),
    );
  }

  if (current.flashLoanEnabled && !desiredFlashLoans) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [asset, false]),
    );
  }

  if (current.paused) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReservePause", [asset, false]),
    );
  }

  if (current.frozen) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [asset, false]),
    );
  }

  if (desiredBorrowing && !current.borrowingEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [asset, true]),
    );
  }

  if (desiredStableBorrowing && !current.stableRateBorrowingEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [asset, true]),
    );
  }

  if (desiredFlashLoans && !current.flashLoanEnabled) {
    await queueSafeCall(
      executor,
      poolConfiguratorAddress,
      poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [asset, true]),
    );
  }
}
