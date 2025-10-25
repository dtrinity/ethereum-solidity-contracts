import { expect } from "chai";
import { network } from "hardhat";

import { getPTMarketInfo, isPT } from "../../typescript/pendle/sdk";
import { ETHEREUM_CHAIN_ID, ETHEREUM_MAINNET_PT_TOKENS, ETHEREUM_PY_FACTORY } from "./fixture";

describe("Pendle SDK Functions", function () {
  // Skip if not on Ethereum mainnet
  before(function () {
    if (network.name !== "ethereum_mainnet") {
      this.skip();
    }
  });

  describe("isPT function", function () {
    it("Should return true for valid PT tokens", async function () {
      for (const [tokenName, tokenInfo] of Object.entries(ETHEREUM_MAINNET_PT_TOKENS)) {
        const result = await isPT(tokenInfo.address, ETHEREUM_PY_FACTORY);
        expect(result, `Expected ${tokenName} to be recognized as PT`).to.be.true;
      }
    });

    it("Should return false for non-PT tokens", async function () {
      // Test with underlying assets (these should not be PT tokens)
      const nonPTTokens = [
        {
          name: "USDC (underlying of PT-aUSDC)",
          address: ETHEREUM_MAINNET_PT_TOKENS.PTsyrupUSDC.asset,
        },
        {
          name: "sUSDe (underlying of PT-sUSDe)",
          address: ETHEREUM_MAINNET_PT_TOKENS.PTsUSDe.underlyingToken,
        },
      ];

      for (const token of nonPTTokens) {
        const result = await isPT(token.address, ETHEREUM_PY_FACTORY);
        expect(result, `Expected ${token.name} to NOT be recognized as PT`).to.be.false;
      }
    });

    it("Should return false for invalid addresses", async function () {
      const invalidAddresses = [
        "0x0000000000000000000000000000000000000000", // Zero address
        "0x1111111111111111111111111111111111111111", // Random address
      ];

      for (const address of invalidAddresses) {
        const result = await isPT(address, ETHEREUM_PY_FACTORY);
        expect(result, `Expected invalid address ${address} to be rejected`).to.be.false;
      }
    });
  });

  describe("getPTMarketInfo function", function () {
    it("Should return correct market info for PT-aUSDC (inactive market)", async function () {
      const ptToken = ETHEREUM_MAINNET_PT_TOKENS.PTsyrupUSDC;
      const marketInfo = await getPTMarketInfo(ptToken.address, ETHEREUM_CHAIN_ID);

      // Verify the structure
      expect(marketInfo).to.have.property("marketAddress");
      expect(marketInfo).to.have.property("underlyingAsset");

      // Verify the values match our fixture data
      expect(marketInfo.marketAddress.toLowerCase()).to.equal(ptToken.market.toLowerCase());
      expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(ptToken.underlyingToken.toLowerCase());
    });

    it("Should return correct market info for PT-sUSDe (active market)", async function () {
      const ptToken = ETHEREUM_MAINNET_PT_TOKENS.PTsUSDe;
      const marketInfo = await getPTMarketInfo(ptToken.address, ETHEREUM_CHAIN_ID);

      // Verify the structure
      expect(marketInfo).to.have.property("marketAddress");
      expect(marketInfo).to.have.property("underlyingAsset");

      // Verify the values match our fixture data
      expect(marketInfo.marketAddress.toLowerCase()).to.equal(ptToken.market.toLowerCase());
      expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(ptToken.underlyingToken.toLowerCase());
    });

    it("Should validate all fixture PT tokens have market info", async function () {
      for (const [tokenName, tokenInfo] of Object.entries(ETHEREUM_MAINNET_PT_TOKENS)) {
        const marketInfo = await getPTMarketInfo(tokenInfo.address, ETHEREUM_CHAIN_ID);

        // Verify the API data matches our fixture data
        expect(marketInfo.marketAddress.toLowerCase()).to.equal(tokenInfo.market.toLowerCase(), `Market address mismatch for ${tokenName}`);

        expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(
          tokenInfo.underlyingToken.toLowerCase(),
          `Underlying asset mismatch for ${tokenName}`,
        );
      }
    });
  });
});
