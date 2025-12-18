import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const routerDeployment = await hre.deployments.deploy("MockFraxEtherRouter", {
    from: deployer,
    contract: "MockFraxEtherRouter",
    args: [],
    autoMine: true,
    log: true,
  });

  const queueDeployment = await hre.deployments.deploy("MockFraxRedemptionQueueV2", {
    from: deployer,
    contract: "MockFraxRedemptionQueueV2",
    args: [],
    autoMine: true,
    log: true,
  });

  const router = await hre.ethers.getContractAt("MockFraxEtherRouter", routerDeployment.address);
  const queue = await hre.ethers.getContractAt("MockFraxRedemptionQueueV2", queueDeployment.address);

  await (await router.setEthTotalBalanced(1_000_000000000000000000n)).wait(); // seed with non-zero backing
  await (await queue.setRedemptionFee(0)).wait();

  console.log(`🧪 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["deploy-mocks", "frax-oracle-mocks"];
func.id = "deploy-mock-frax-frxeth-oracle-deps";

export default func;

