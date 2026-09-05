import { ethers } from "hardhat";

// Self-contained deployment fixture: no named-account or legacy fixture coupling.
export async function backingFixture() {
  const [admin, user, other] = await ethers.getSigners();
  const asset: any = await (await ethers.getContractFactory("IncidentMintableERC20")).deploy();
  const tokenFactory = await ethers.getContractFactory("DStakeTokenV2");
  const impl = await tokenFactory.deploy();
  const proxy = await (await ethers.getContractFactory("ERC1967Proxy")).deploy(
    impl.target,
    tokenFactory.interface.encodeFunctionData("initialize", [asset.target, "Test sdUSD", "TSD", admin.address, admin.address]),
  );
  const token: any = await ethers.getContractAt("DStakeTokenV2", proxy.target);
  const collateral: any = await (await ethers.getContractFactory("DStakeCollateralVaultV2")).deploy(token.target, asset.target);
  const router: any = await (await ethers.getContractFactory("DStakeRouterV2")).deploy(token.target, collateral.target);
  for (const [name, setter] of [
    ["DStakeRouterV2GovernanceModule", "setGovernanceModule"],
    ["DStakeRouterV2RebalanceModule", "setRebalanceModule"],
  ]) {
    const module = await (await ethers.getContractFactory(name)).deploy(token.target, collateral.target);
    await router[setter](module.target);
  }
  await collateral.setRouter(router.target);
  await token.migrateCore(router.target, collateral.target);
  await router.grantRole(await router.STRATEGY_REBALANCER_ROLE(), admin.address);

  async function addVault(idle = false, weight = 1_000_000) {
    const vault: any = idle
      ? await (await ethers.getContractFactory("DStakeIdleVault")).deploy(asset.target, "Legacy Idle", "LIDLE", admin.address, admin.address)
      : await (await ethers.getContractFactory("IncidentAccountingVault")).deploy(asset.target);
    const adapter: any = await (await ethers.getContractFactory("GenericERC4626ConversionAdapter")).deploy(asset.target, vault.target, collateral.target);
    await adapter.setAuthorizedCaller(router.target, true);
    await router["addVaultConfig(address,address,uint256,uint8)"](vault.target, adapter.target, weight, 0);
    return { vault, adapter };
  }
  const { vault, adapter } = await addVault();
  await router.setDefaultDepositStrategyShare(vault.target);
  for (const signer of [admin, user, other]) {
    await asset.mint(signer.address, 10n ** 26n);
    await asset.connect(signer).approve(router.target, ethers.MaxUint256);
    await asset.connect(signer).approve(token.target, ethers.MaxUint256);
  }
  const deposit = (amount: bigint, v = vault.target) => router.connect(user).solverDepositAssets([v], [amount], 0, user.address);
  return { admin, user, other, asset, token, collateral, router, vault, adapter, addVault, deposit };
}
