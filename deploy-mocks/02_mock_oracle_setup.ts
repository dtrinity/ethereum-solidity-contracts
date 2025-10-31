import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../typescript/hardhat/deploy";

export interface OracleFeedConfig {
  name: string;
  price: string;
}

export type OracleProvider = "REDSTONE";

const redstoneFeeds: OracleFeedConfig[] = [
  { name: "USDC_USD", price: "1" },
  { name: "USDT_USD", price: "1" },
  { name: "USDS_USD", price: "1" },
  { name: "AUSD_USD", price: "1" },
  { name: "frxUSD_USD", price: "1" },
  { name: "fxUSD_USD", price: "1" },
  { name: "yUSD_USD", price: "1" },
  { name: "aUSDC_USD", price: "1" },
  { name: "aUSDT_USD", price: "1" },
  { name: "sfrxUSD_frxUSD", price: "1.05" },
  { name: "sUSDS_USDS", price: "1.02" },
  { name: "fxSAVE_fxUSD", price: "1.02" },
  { name: "WETH_USD", price: "3200" },
  { name: "stETH_WETH", price: "1.0" },
  { name: "sfrxETH_WETH", price: "1.02" },
  { name: "rETH_WETH", price: "1.03" },
];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - mock oracle setup should not run on mainnet");
  }

  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleNameToProvider: Record<string, OracleProvider> = {};

  for (const feed of redstoneFeeds) {
    const deploymentId = `MockRedstoneChainlinkOracleAlwaysAlive_${feed.name}`;
    const mockOracle = await hre.deployments.deploy(deploymentId, {
      from: deployer,
      args: [],
      contract: "MockRedstoneChainlinkOracleAlwaysAlive",
      autoMine: true,
      log: false,
    });

    const contract = await hre.ethers.getContractAt(
      "MockRedstoneChainlinkOracleAlwaysAlive",
      mockOracle.address,
      signer,
    );

    const price = hre.ethers.parseUnits(feed.price, 8);
    await contract.setMock(price);

    mockOracleNameToAddress[feed.name] = mockOracle.address;
    mockOracleNameToProvider[feed.name] = "REDSTONE";

    console.log(`🔮 Deployed ${deploymentId} at ${mockOracle.address} with price ${feed.price}`);
  }

  await hre.deployments.save("MockOracleNameToAddress", {
    address: ZeroAddress,
    abi: [],
    linkedData: mockOracleNameToAddress,
  });

  await hre.deployments.save("MockOracleNameToProvider", {
    address: ZeroAddress,
    abi: [],
    linkedData: mockOracleNameToProvider,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "oracle"];
func.dependencies = ["tokens"];
func.id = "local_oracle_setup";

export default func;
