/**
 * Basic sanity check helper for oracle wrappers.
 * TODO: Extend or replace once the V1.1 deployment tooling is implemented.
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
