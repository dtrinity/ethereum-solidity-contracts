import type { ContractTransactionResponse, TransactionReceipt } from "ethers";

/**
 * Wait for a transaction receipt. Falls back to provider.waitForTransaction when
 * tx.wait() fails on flaky public RPCs (Hardhat HH110 / truncated JSON-RPC bodies).
 */
export async function waitForTxReceipt(
  tx: ContractTransactionResponse,
  options?: {
    confirmations?: number;
    timeoutMs?: number;
    onRetry?: (message: string) => void;
  },
): Promise<TransactionReceipt | null> {
  const confirmations = options?.confirmations ?? 1;
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const onRetry = options?.onRetry;

  try {
    return await tx.wait(confirmations);
  } catch (error) {
    const hash = tx.hash;
    if (!hash || !tx.provider) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    onRetry?.(`tx.wait() failed (${message}); polling receipt for ${hash}...`);
    return tx.provider.waitForTransaction(hash, confirmations, timeoutMs);
  }
}
