import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { LitUSDVaultConfig } from "../../config/types";
import { LITUSD_VAULT_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, getOrNull } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);
  const vaultConfig = config.litUSDVault as LitUSDVaultConfig | undefined;

  if (!vaultConfig) {
    console.log("No litUSD vault configuration found for this network. Skipping deployment.");
    return;
  }

  const litUSD = vaultConfig.litUSD;
  const bankPoRFeed = vaultConfig.bankPoRFeed;

  if (!litUSD || litUSD === ethers.ZeroAddress || litUSD === "") {
    console.warn("Skipping litUSD vault deployment: litUSD address not configured.");
    return;
  }

  if (!bankPoRFeed || bankPoRFeed === ethers.ZeroAddress || bankPoRFeed === "") {
    console.warn("Skipping litUSD vault deployment: bank PoR feed address not configured.");
    return;
  }

  const admin = vaultConfig.admin && vaultConfig.admin !== "" ? vaultConfig.admin : deployer;
  const withdrawer = vaultConfig.withdrawer && vaultConfig.withdrawer !== "" ? vaultConfig.withdrawer : admin;
  const deploymentName = vaultConfig.deploymentName && vaultConfig.deploymentName !== "" ? vaultConfig.deploymentName : LITUSD_VAULT_ID;

  const existing = await getOrNull(deploymentName);

  if (existing) {
    console.log(`litUSD vault already deployed at ${existing.address}. Skipping deployment.`);
    return;
  }

  const deployment = await deploy(deploymentName, {
    from: deployer,
    contract: "LitUSDVault",
    args: [litUSD, bankPoRFeed, admin, withdrawer],
    log: false,
  });

  if (vaultConfig.slippageBps !== undefined) {
    const signer = await ethers.getSigner(deployer);
    const vault = await ethers.getContractAt("LitUSDVault", deployment.address, signer);
    await vault.setSlippageBps(vaultConfig.slippageBps);
  }

  console.log(`🧊 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.id = "deploy_litusd_vault";
func.tags = ["litUSDVault", "litUSD"];
