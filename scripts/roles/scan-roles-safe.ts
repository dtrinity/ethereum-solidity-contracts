import { getConfig } from "../../config/config";
import { scanRolesAndOwnership } from "./lib/scan";

async function main() {
  const hre = require("hardhat");
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);
  const governance = config.walletAddresses.governanceMultisig;

  console.log(`Scanning Safe-held roles on ${hre.network.name}`);
  console.log(`Safe (governance): ${governance}`);
  console.log(`Deployer: ${deployer}`);

  const result = await scanRolesAndOwnership(hre, deployer, governance, () => {});

  // Show what the SAFE holds on every AC contract
  console.log("\n=== AccessControl contracts: Safe-held roles ===");
  let totalSafePairs = 0;
  for (const c of result.rolesContracts) {
    if (c.rolesHeldByGovernance.length > 0) {
      totalSafePairs += c.rolesHeldByGovernance.length;
      console.log(`- ${c.name} (${c.address})`);
      console.log(`  governanceHasDefaultAdmin=${c.governanceHasDefaultAdmin}`);
      for (const r of c.rolesHeldByGovernance) {
        console.log(`    * ${r.name} (${r.hash})`);
      }
    }
  }

  console.log(`\nSafe holds ${totalSafePairs} role/contract pairs across ${result.rolesContracts.filter((c) => c.rolesHeldByGovernance.length > 0).length} AC contracts.`);

  // Also list AC contracts where the Safe holds NO roles at all
  console.log("\n=== AC contracts where Safe holds NO roles ===");
  for (const c of result.rolesContracts) {
    if (c.rolesHeldByGovernance.length === 0) {
      console.log(`- ${c.name} (${c.address})  [deployerRoles=${c.rolesHeldByDeployer.map((r) => r.name).join(", ") || "none"}]`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
