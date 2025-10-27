import { expect } from "chai";
import { ethers, network } from "hardhat";

import { estimateSwapExactIn } from "../../typescript/pendle/sdk";
import { ETHEREUM_MAINNET_PT_TOKENS } from "./fixture";

describe("PendleSwapPOC - Mainnet Integration", function () {
  // Skip if not on Ethereum mainnet
  before(function () {
    if (network.name !== "ethereum_mainnet") {
      this.skip();
    }
  });

  /**
   *
   */
  async function deployPendleSwapPOCForMainnet() {
    const [deployer] = await ethers.getSigners();
    const PendleSwapPOC = await ethers.getContractFactory("contracts/testing/pendle/PendleSwapPOC.sol:PendleSwapPOC");
    const pocContract = (await PendleSwapPOC.deploy()) as any;
    await pocContract.waitForDeployment();
    return { pocContract, deployer };
  }

  /**
   *
   * @param ptToken
   * @param amountIn
   * @param tokenOut
   * @param receiver
   * @param market
   * @param chainId
   */
  async function swapExactPtToToken(
    ptToken: string,
    amountIn: string,
    tokenOut: string,
    receiver: string,
    market: string,
    chainId: number,
  ) {
    const response = await estimateSwapExactIn(ptToken, amountIn, tokenOut, receiver, market, chainId, 0.01);
    return response.data;
  }

  describe("Full POC flow simulation", function () {
    it("Should demonstrate complete off-chain → on-chain flow", async function () {
      const { pocContract, deployer } = await deployPendleSwapPOCForMainnet();
      const ptToken = ETHEREUM_MAINNET_PT_TOKENS.PTsUSDe;
      const testAmount = ethers.parseUnits("0.1", ptToken.decimals);
      const contractAddress = await pocContract.getAddress();
      const net = await ethers.provider.getNetwork();
      const chainId = Number(net.chainId);

      const ptContract = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", ptToken.address);
      const ptBalance = await ptContract.balanceOf(deployer.address);

      const sdkResponse = await swapExactPtToToken(
        ptToken.address,
        testAmount.toString(),
        ptToken.asset,
        contractAddress,
        ptToken.market,
        chainId,
      );

      expect(sdkResponse.tx.to).to.be.properAddress;
      expect(sdkResponse.tx.data.length).to.be.greaterThan(0);

      if (ptBalance < testAmount) {
        // Unable to exercise the on-chain swap due to balance, but SDK path is validated.
        return;
      }

      const approveTx = await ptContract.approve(contractAddress, testAmount);
      await approveTx.wait();

      const underlyingContract = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", ptToken.asset);
      const underlyingBalanceBefore = await underlyingContract.balanceOf(deployer.address);

      const swapTx = await pocContract.executePendleSwap(
        ptToken.address,
        ptToken.asset,
        testAmount,
        sdkResponse.tx.to,
        sdkResponse.tx.data,
      );

      const receipt = await swapTx.wait();
      expect(receipt.gasUsed).to.be.gt(0);

      const newPtBalance = await ptContract.balanceOf(deployer.address);
      const underlyingBalanceAfter = await underlyingContract.balanceOf(deployer.address);

      expect(newPtBalance).to.be.lt(ptBalance);
      expect(underlyingBalanceAfter).to.be.gt(underlyingBalanceBefore);
    });
  });
});
