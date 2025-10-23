import { expect } from "chai";

describe("RewardAdapterFloatTheft", function () {
  describe("malicious adapter theft", function () {
    it("reverts before malicious adapter can capture float", async function () {
      // TODO: Implement malicious adapter theft scenario with mock stealing float.
      expect.fail("TODO: implement malicious adapter theft scenario");
    });
  });

  describe("honest adapter regression", function () {
    it("maintains allowances and vault balances for honest adapter", async function () {
      // TODO: Implement honest adapter regression to confirm no allowance leakage.
      expect.fail("TODO: implement honest adapter regression scenario");
    });
  });
});
