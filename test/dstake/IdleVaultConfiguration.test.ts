import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { DStakeRouterV2 } from "../../typechain-types";
import { SDUSD_ROUTER_ID, SDETH_ROUTER_ID } from "../../typescript/deploy-ids";

describe("dStake Idle Vault Configuration", () => {
  const dStakeIdleVaultTags = [
    "local-setup",
    "oracle",
    "dusd",
    "deth",
    "dlend",
    "dUSD-aTokenWrapper",
    "dETH-aTokenWrapper",
    "dlend-static-wrapper-factory",
    "dStake",
    "ds",
  ];

  it("should have the sdUSD idle vault configured as the default deposit strategy", async () => {
    // Run the full deployment fixture for dStake
    await deployments.fixture(dStakeIdleVaultTags);

    const routerDeployment = await deployments.get(SDUSD_ROUTER_ID);
    const router = (await ethers.getContractAt("DStakeRouterV2", routerDeployment.address)) as DStakeRouterV2;

    const idleVaultDeployment = await deployments.get("DStakeIdleVault_sdUSD");
    const defaultDepositStrategy = await router.defaultDepositStrategyShare();

    expect(defaultDepositStrategy).to.equal(idleVaultDeployment.address);

    const adapter = await router.strategyShareToAdapter(defaultDepositStrategy);
    expect(adapter).to.not.equal(ethers.ZeroAddress);

    // Check it's registered in vault configs
    const vaultCount = await router.getVaultCount();
    let found = false;
    for (let i = 0; i < Number(vaultCount); i++) {
      const config = await router.getVaultConfigByIndex(i);
      if (config.strategyVault === defaultDepositStrategy) {
        found = true;
        break;
      }
    }
    expect(found).to.be.true;
  });

  it("should have the sdETH idle vault configured as the default deposit strategy", async () => {
    // Fixture already run above, but good practice to ensure state if independent
    await deployments.fixture(dStakeIdleVaultTags);

    const routerDeployment = await deployments.get(SDETH_ROUTER_ID);
    const router = (await ethers.getContractAt("DStakeRouterV2", routerDeployment.address)) as DStakeRouterV2;

    const idleVaultDeployment = await deployments.get("DStakeIdleVault_sdETH");
    const defaultDepositStrategy = await router.defaultDepositStrategyShare();

    expect(defaultDepositStrategy).to.equal(idleVaultDeployment.address);

    const adapter = await router.strategyShareToAdapter(defaultDepositStrategy);
    expect(adapter).to.not.equal(ethers.ZeroAddress);

    const vaultCount = await router.getVaultCount();
    let found = false;
    for (let i = 0; i < Number(vaultCount); i++) {
      const config = await router.getVaultConfigByIndex(i);
      if (config.strategyVault === defaultDepositStrategy) {
        found = true;
        break;
      }
    }
    expect(found).to.be.true;
  });
});
