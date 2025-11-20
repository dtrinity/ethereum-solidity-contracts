import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockPendleRouter, deployMockRouter, mint } from "./utils/setup";

const { MaxUint256, ZeroHash, parseUnits } = ethers;

describe("OdosRepayAdapterV2 - non-flash excess debt handling", function () {
  it("returns surplus debt tokens to the user when swap output exceeds repay amount", async function () {
    const [user, owner] = await ethers.getSigners();

    const collateral = await deployMintableERC20("Collateral", "COL");
    const debt = await deployMintableERC20("Debt", "DEBT");
    const aToken = await deployMintableERC20("aCOL", "aCOL");
    const vDebt = await deployMintableERC20("vDEBT", "vDEBT");

    const PriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const priceOracle = await PriceOracle.deploy();

    const AddressesProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
    const addressesProvider = await AddressesProvider.deploy();
    await addressesProvider.setPriceOracle(await priceOracle.getAddress());

    const Pool = await ethers.getContractFactory("MockAavePool");
    const pool = await Pool.deploy(await addressesProvider.getAddress());
    await pool.setFlashLoanPremiumTotal(0);
    await pool.setReserveData(await collateral.getAddress(), await aToken.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);
    await pool.setReserveData(await debt.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, await vDebt.getAddress());

    const router = await deployMockRouter();
    const pendleRouter = await deployMockPendleRouter();

    const Adapter = await ethers.getContractFactory("OdosRepayAdapterV2");
    const adapter = await Adapter.deploy(
      await addressesProvider.getAddress(),
      await pool.getAddress(),
      await router.getAddress(),
      await pendleRouter.getAddress(),
      owner.address,
    );

    for (const token of [collateral, debt]) {
      await priceOracle.setAssetPrice(await token.getAddress(), parseUnits("1", 8));
    }

    const repayAmount = parseUnits("100", 18);
    const debtTokensFromSwap = parseUnits("120", 18); // positive slippage
    const collateralAmount = repayAmount; // keep oracle deviation within tolerance and avoid excess collateral path

    await mint(aToken, user.address, collateralAmount);
    await mint(collateral, await pool.getAddress(), collateralAmount);
    await mint(vDebt, user.address, repayAmount);
    await mint(debt, await router.getAddress(), debtTokensFromSwap);

    await aToken.connect(user).approve(await adapter.getAddress(), MaxUint256);

    await router.setSwapBehaviour(await collateral.getAddress(), await debt.getAddress(), collateralAmount, debtTokensFromSwap, false);

    const swapData = router.interface.encodeFunctionData("performSwap");

    const repayParams = {
      collateralAsset: await collateral.getAddress(),
      collateralAmount,
      debtAsset: await debt.getAddress(),
      repayAmount,
      rateMode: 2,
      withFlashLoan: false,
      minAmountToReceive: repayAmount,
      swapData,
      allBalanceOffset: 0,
    };

    const permit = {
      aToken: await aToken.getAddress(),
      value: 0,
      deadline: 0,
      v: 0,
      r: ZeroHash,
      s: ZeroHash,
    };

    const expectedExcess = debtTokensFromSwap - repayAmount;

    await expect(adapter.connect(user).repayWithCollateral(repayParams, permit))
      .to.emit(adapter, "ExcessDebtTokensReturned")
      .withArgs(await debt.getAddress(), expectedExcess, user.address);

    expect(await debt.balanceOf(user.address)).to.equal(expectedExcess);
    expect(await debt.balanceOf(await adapter.getAddress())).to.equal(0);
  });
});
