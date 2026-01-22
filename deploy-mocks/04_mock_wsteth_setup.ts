import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../typescript/hardhat/deploy";

type OracleProvider = "REDSTONE";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - mock wstETH setup should not run on mainnet");
  }

  // ---- Token: wstETH ----
  await hre.deployments.deploy("wstETH", {
    contract: "TestERC20",
    from: deployer,
    args: ["Wrapped stETH", "wstETH", 18],
    autoMine: true,
    log: false,
    skipIfAlreadyDeployed: true,
  });

  // ---- Oracle feed: wstETH/stETH ----
  const feedName = "wstETH_stETH";
  const oracleDeploymentId = `MockRedstoneChainlinkOracleAlwaysAlive_${feedName}`;
  const oracle = await hre.deployments.deploy(oracleDeploymentId, {
    from: deployer,
    args: [],
    contract: "MockRedstoneChainlinkOracleAlwaysAlive",
    autoMine: true,
    log: false,
    skipIfAlreadyDeployed: true,
  });

  const oracleContract = await hre.ethers.getContractAt("MockRedstoneChainlinkOracleAlwaysAlive", oracle.address, signer);
  // Price is 8 decimals (Chainlink-style). Mock wstETH ≈ 1.10 stETH.
  await oracleContract.setMock(hre.ethers.parseUnits("1.10", 8));

  // ---- Update linkedData maps used by config builders ----
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleNameToProvider: Record<string, OracleProvider> = {};

  const existingAddresses = await hre.deployments.getOrNull("MockOracleNameToAddress");
  if (existingAddresses?.linkedData) {
    Object.assign(mockOracleNameToAddress, existingAddresses.linkedData as Record<string, string>);
  }

  const existingProviders = await hre.deployments.getOrNull("MockOracleNameToProvider");
  if (existingProviders?.linkedData) {
    Object.assign(mockOracleNameToProvider, existingProviders.linkedData as Record<string, OracleProvider>);
  }

  mockOracleNameToAddress[feedName] = oracle.address;
  mockOracleNameToProvider[feedName] = "REDSTONE";

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

  console.log(`🧪 wstETH mocks ready: token=wstETH, feed=${feedName}`);
  console.log(`🧪 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "tokens", "oracle"];
func.id = "mock_wsteth_setup";

export default func;

