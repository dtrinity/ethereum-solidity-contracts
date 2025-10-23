import { expect } from "chai";

describe("RewardExchangeDust", function () {
  describe("dust elimination", function () {
    it("sweeps exchange-asset dust back to zero after compounding", async function () {
      // TODO: Seed uneven exchange asset positions and assert zero residual dust post-compound.
      expect.fail("TODO: implement dust sweep regression");
    });
  });

  describe("ordering invariance", function () {
    it("prevents dust leakage regardless of reward token order", async function () {
      // TODO: Fuzz reward ordering to ensure dust outcomes remain invariant.
      expect.fail("TODO: implement reward ordering invariance check");
    });
  });
});
