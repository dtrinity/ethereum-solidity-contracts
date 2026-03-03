import { expect } from "chai";
import { ethers, network } from "hardhat";

const ONE = 10n ** 18n;
const FEE_PRECISION = 1_000_000n;

const FRXETH = "0x5e8422345238f34275888049021821e8e08caa1f";
const ETHER_ROUTER = "0x5acAf61d339dd123e60ba450Ea38fbC49445007C";
const REDEMPTION_QUEUE = "0xfDC69e6BE352BD5644C438302DE4E311AAD5565b";

const FORK_URL = process.env.ETHEREUM_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
const FORK_BLOCK = process.env.ETHEREUM_FORK_BLOCK ? Number(process.env.ETHEREUM_FORK_BLOCK) : 19_000_000;
const RUN_FORK_TESTS = process.env.RUN_FORK_TESTS === "true";

const ERC20_ABI = ["function totalSupply() view returns (uint256)"];
const REDEMPTION_QUEUE_ABI = [
  "function redemptionQueueState() view returns (uint64 nextNftId, uint64 queueLengthSecs, uint64 redemptionFee, uint120 ttlEthRequested, uint120 ttlEthServed)",
  "function ethShortageOrSurplus() view returns (bool isEthShortage, uint256 amount)",
];
const ETHER_ROUTER_IFACE = new ethers.Interface(["function getConsolidatedEthFrxEthBalanceView(bool) view"]);
const MAX_UINT160 = (1n << 160n) - 1n;

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const getFeeOverrides = async () => {
  const block = await ethers.provider.getBlock("latest");
  const baseFee = block?.baseFeePerGas ?? 0n;
  const priorityFee = ethers.parseUnits("2", "gwei");
  const maxFee = baseFee > 0n ? baseFee * 2n + priorityFee : ethers.parseUnits("30", "gwei");

  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priorityFee };
};
const decodeEthTotalBalanced = (data: string) => {
  const bytes = ethers.getBytes(data);
  if (bytes.length % 32 !== 0) {
    return { ok: false, isStale: false, ethTotalBalanced: 0n };
  }

  const words = bytes.length / 32;
  if (words < 6) {
    return { ok: false, isStale: false, ethTotalBalanced: 0n };
  }

  const loadWord = (index: number) =>
    BigInt(ethers.hexlify(bytes.slice(index * 32, (index + 1) * 32)));
  const word0 = loadWord(0);
  const word1 = loadWord(1);

  if (words >= 7 && word0 <= 1n && word1 <= MAX_UINT160) {
    return { ok: true, isStale: word0 === 1n, ethTotalBalanced: loadWord(4) };
  }

  return { ok: true, isStale: false, ethTotalBalanced: loadWord(2) };
};
const describeFork = RUN_FORK_TESTS ? describe : describe.skip;

describeFork("FrxEthFundamentalOracleWrapperV1_1 (fork)", () => {
  before(async function () {
    this.timeout(120_000);
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: FORK_URL, blockNumber: FORK_BLOCK } }],
    });
  });

  it("returns a capped fundamental rate using mainnet data", async () => {
    const wrapperFactory = await ethers.getContractFactory("FrxEthFundamentalOracleWrapperV1_1");
    const wrapper = await wrapperFactory.deploy(
      ethers.ZeroAddress,
      ONE,
      FRXETH,
      ETHER_ROUTER,
      REDEMPTION_QUEUE,
      await getFeeOverrides(),
    );

    const [price, alive] = await wrapper.getPriceInfo(FRXETH);

    const frxEth = await ethers.getContractAt(ERC20_ABI, FRXETH);
    const queue = await ethers.getContractAt(REDEMPTION_QUEUE_ABI, REDEMPTION_QUEUE);

    const supply = await frxEth.totalSupply();
    const routerCall = ETHER_ROUTER_IFACE.encodeFunctionData("getConsolidatedEthFrxEthBalanceView", [true]);
    const routerRaw = await ethers.provider.call({ to: ETHER_ROUTER, data: routerCall });
    const balances = decodeEthTotalBalanced(routerRaw);
    let redemptionFee = 0n;
    let isEthShortage = false;
    let shortageAmount = 0n;
    let queueReadable = true;

    try {
      [, , redemptionFee] = await queue.redemptionQueueState();
      [isEthShortage, shortageAmount] = await queue.ethShortageOrSurplus();
    } catch {
      queueReadable = false;
    }

    expect(supply).to.be.gt(0n);
    if (queueReadable) {
      expect(redemptionFee).to.be.lt(FEE_PRECISION);
    }
    let nav = 0n;
    if (balances.ok && !balances.isStale) {
      nav = (balances.ethTotalBalanced * ONE) / supply;
      if (isEthShortage) {
        nav = shortageAmount >= balances.ethTotalBalanced ? 0n : ((balances.ethTotalBalanced - shortageAmount) * ONE) / supply;
      }
    }
    const redemptionRate = queueReadable ? (ONE * (FEE_PRECISION - redemptionFee)) / FEE_PRECISION : 0n;
    const navFloor = ONE / 1000n;
    const expected =
      !isEthShortage && nav > 0n && nav < navFloor
        ? min(redemptionRate, ONE)
        : min(min(nav, ONE), redemptionRate);

    expect(price).to.equal(expected);
    expect(alive).to.equal(expected > 0n);
  });
});
