import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockPendleRouter, deployMockRouter, mint } from "./utils/setup";

const { MaxUint256, ZeroHash, parseUnits } = ethers;

describe("OdosDebtSwapAdapterV2 nested flashloan extra collateral", function () {
  it("does not double-pull user collateral or leave it trapped", async function () {
    const [user] = await ethers.getSigners();

    const collateral = await deployMintableERC20("Collateral", "COL");
    const debt = await deployMintableERC20("Debt", "DEBT");
    const newDebt = await deployMintableERC20("NewDebt", "NDEBT");
    const aToken = await deployMintableERC20("aCOL", "aCOL");
    const vToken = await deployMintableERC20("vDEBT", "vDEBT");

    const PriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const priceOracle = await PriceOracle.deploy();

    const AddressesProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
    const addressesProvider = await AddressesProvider.deploy();
    await addressesProvider.setPriceOracle(await priceOracle.getAddress());

    const Pool = await ethers.getContractFactory("MockAavePool");
    const pool = await Pool.deploy(await addressesProvider.getAddress());
    await pool.setFlashLoanPremiumTotal(0);
    await pool.setReserveData(await collateral.getAddress(), await aToken.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);
    await pool.setReserveData(await debt.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, await vToken.getAddress());
    await pool.setReserveData(await newDebt.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);

    const router = await deployMockRouter();
    const pendleRouter = await deployMockPendleRouter();

    const Adapter = await ethers.getContractFactory("OdosDebtSwapAdapterV2");
    const adapter = await Adapter.deploy(
      await addressesProvider.getAddress(),
      await pool.getAddress(),
      await router.getAddress(),
      await pendleRouter.getAddress(),
      user.address,
    );

    for (const token of [collateral, debt, newDebt]) {
      await priceOracle.setAssetPrice(await token.getAddress(), parseUnits("1", 8));
    }

    const extraCollateralAmount = parseUnits("100", 18);
    const nestedFlashAmount = parseUnits("50", 18);
    const debtRepayAmount = nestedFlashAmount;

    await mint(collateral, await pool.getAddress(), extraCollateralAmount * 2n);
    await mint(newDebt, await pool.getAddress(), nestedFlashAmount * 2n);
    await mint(debt, await router.getAddress(), debtRepayAmount);

    await mint(aToken, user.address, extraCollateralAmount);
    await mint(vToken, user.address, debtRepayAmount);
    await aToken.connect(user).approve(await adapter.getAddress(), MaxUint256);

    await router.setSwapBehaviour(
      await newDebt.getAddress(),
      await debt.getAddress(),
      nestedFlashAmount,
      debtRepayAmount,
      false,
    );

    const swapData = router.interface.encodeFunctionData("performSwap");

    const debtSwapParams = {
      debtAsset: await debt.getAddress(),
      debtRepayAmount,
      debtRateMode: 2,
      newDebtAsset: await newDebt.getAddress(),
      maxNewDebtAmount: nestedFlashAmount,
      extraCollateralAsset: await collateral.getAddress(),
      extraCollateralAmount,
      swapData,
      allBalanceOffset: 0,
    };

    const creditDelegationPermit = {
      debtToken: await debt.getAddress(),
      value: 0,
      deadline: 0,
      v: 0,
      r: ZeroHash,
      s: ZeroHash,
    };

    const collateralATokenPermit = {
      aToken: await aToken.getAddress(),
      value: 0,
      deadline: 0,
      v: 0,
      r: ZeroHash,
      s: ZeroHash,
    };

    const userATokenBefore = await aToken.balanceOf(user.address);

    await adapter.connect(user).swapDebt(debtSwapParams, creditDelegationPermit, collateralATokenPermit);

    const userATokenAfter = await aToken.balanceOf(user.address);
    const adapterCollateralBalance = await collateral.balanceOf(await adapter.getAddress());

    expect(userATokenAfter).to.equal(userATokenBefore);
    expect(adapterCollateralBalance).to.equal(0);
  });
});
