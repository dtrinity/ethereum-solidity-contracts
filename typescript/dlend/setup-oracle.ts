/**
 * Minimal wrapper interface used for sanity checks.
 */
type OracleWrapper = {
  getAssetPrice: (asset: string) => Promise<bigint>;
};

/**
 * Basic sanity check helper for oracle wrappers.
 * TODO: Extend or replace once the V1.1 deployment tooling is implemented.
 *
 * @param wrapper - Wrapper contract instance that exposes `getAssetPrice`.
 * @param feeds - Mapping of asset address to friendly feed name for logging.
 * @param baseCurrencyUnit - Scaling factor that converts raw prices to decimals.
 * @param wrapperName - Human readable label included in thrown error messages.
 * @param minPrice - Inclusive lower bound for acceptable normalised pricing.
 * @param maxPrice - Inclusive upper bound for acceptable normalised pricing.
 */
export async function performOracleSanityChecks(
  wrapper: OracleWrapper,
  feeds: Record<string, unknown>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
  minPrice: number,
  maxPrice: number,
): Promise<void> {
  for (const assetAddress of Object.keys(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (Number.isNaN(normalizedPrice)) {
        throw new Error(`Normalized price for ${assetAddress} resolved to NaN`);
      }

      if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: normalised price ${normalizedPrice} outside range [${minPrice}, ${maxPrice}]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: normalised price ${normalizedPrice} outside range [${minPrice}, ${maxPrice}]`,
        );
      }

      console.log(
        `Sanity check passed for asset ${assetAddress} in ${wrapperName}: normalised price ${normalizedPrice} within [${minPrice}, ${maxPrice}]`,
      );
    } catch (error) {
      console.error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`, error);
      throw new Error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`);
    }
  }
}
