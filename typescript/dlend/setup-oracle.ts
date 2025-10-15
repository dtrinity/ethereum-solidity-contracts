/**
 * Basic sanity check helper for oracle wrappers.
 * TODO: Extend or replace once the V1.1 deployment tooling is implemented.
 *
 * @param wrapper Wrapper contract instance that exposes `getAssetPrice`.
 * @param wrapper.getAssetPrice Method used to query price data for an asset.
 * @param feeds Mapping of asset address to friendly feed name for logging.
 * @param baseCurrencyUnit Scaling factor that converts raw prices to decimals.
 * @param wrapperName Human readable label included in thrown error messages.
 * @param minPrice Inclusive lower bound for acceptable normalised pricing.
 * @param maxPrice Inclusive upper bound for acceptable normalised pricing.
 */
export async function performOracleSanityChecks(
  wrapper: { getAssetPrice: (asset: string) => Promise<bigint> },
  feeds: Record<string, unknown>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
  minPrice: number,
  maxPrice: number
): Promise<void> {
  for (const assetAddress of Object.keys(feeds)) {
    const price = await wrapper.getAssetPrice(assetAddress);
    const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

    if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
      throw new Error(
        `Sanity check failed for ${wrapperName} (${assetAddress}): ${normalizedPrice} outside range [${minPrice}, ${maxPrice}]`
      );
    }
  }
}
