import { HardhatRuntimeEnvironment } from "hardhat/types";
import * as fs from "fs";
import * as path from "path";

export interface RoleInfo {
  name: string;
  hash: string;
}

export interface RolesContractInfo {
  name: string;
  address: string;
  abi: unknown[];
  roles: RoleInfo[];
  rolesHeldByDeployer: RoleInfo[];
  rolesHeldByGovernance: RoleInfo[];
  defaultAdminRoleHash?: string;
  governanceHasDefaultAdmin: boolean;
}

export interface OwnableContractInfo {
  name: string;
  address: string;
  abi: unknown[];
  owner: string;
  deployerIsOwner: boolean;
}

export interface ScanResult {
  rolesContracts: RolesContractInfo[];
  ownableContracts: OwnableContractInfo[];
}

/**
 * Scan deployment artifacts for AccessControl roles and Ownable ownership.
 * Returns a structured result that can be used by revoke/transfer scripts.
 */
export async function scanRolesAndOwnership(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  governanceMultisig: string,
  logger?: (message: string) => void,
): Promise<ScanResult> {
  const { ethers, network } = hre;
  const log = logger || (() => {});

  const deploymentsPath = path.join(hre.config.paths.deployments, network.name);

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployments directory not found for network ${network.name}: ${deploymentsPath}`);
  }

  const deploymentFiles = fs
    .readdirSync(deploymentsPath)
    .filter((f) => f.endsWith(".json") && f !== ".migrations.json" && f !== "solcInputs");

  const rolesContracts: RolesContractInfo[] = [];
  const ownableContracts: OwnableContractInfo[] = [];

  for (const filename of deploymentFiles) {
    try {
      const artifactPath = path.join(deploymentsPath, filename);
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      const abi = deployment.abi as unknown[];
      const contractAddress: string = deployment.address;
      const contractName: string = deployment.contractName || filename.replace(".json", "");

      // Detect AccessControl (hasRole(bytes32,address) view returns bool)
      const hasRoleFn = abi.some((rawItem) => {
        const item = rawItem as any;

        if (item?.type !== "function" || typeof item.name !== "string") {
          return false;
        }

        const inputs = item.inputs ?? [];
        const outputs = item.outputs ?? [];

        return (
          item.name === "hasRole" &&
          inputs.length === 2 &&
          inputs[0]?.type === "bytes32" &&
          inputs[1]?.type === "address" &&
          outputs.length === 1 &&
          outputs[0]?.type === "bool"
        );
      });

      const ownerFn = abi.some((rawItem) => {
        const item = rawItem as any;

        if (item?.type !== "function" || typeof item.name !== "string") {
          return false;
        }

        const outputs = item.outputs ?? [];

        return (
          item.name === "owner" &&
          (item.inputs?.length ?? 0) === 0 &&
          outputs.length === 1 &&
          outputs[0]?.type === "address"
        );
      });

      const contractInstance = hasRoleFn || ownerFn ? await ethers.getContractAt(abi as any, contractAddress) : null;

      if (hasRoleFn && contractInstance) {
        const contract = contractInstance as any;
        log(`  Contract ${contractName} has a hasRole function.`);
        log(`\nChecking roles for contract: ${contractName} at ${contractAddress}`);
        const roles: RoleInfo[] = [];

        // Collect role constants as view functions returning bytes32
        for (const rawItem of abi) {
          const item = rawItem as any;

          if (item?.type !== "function" || typeof item.name !== "string") {
            continue;
          }

          if (
            item.stateMutability === "view" &&
            (item.name?.endsWith("_ROLE") || item.name === "DEFAULT_ADMIN_ROLE") &&
            (item.inputs?.length ?? 0) === 0 &&
            item.outputs?.length === 1 &&
            item.outputs[0]?.type === "bytes32"
          ) {
            try {
              const roleHash: string = await contract[item.name]();
              roles.push({ name: item.name, hash: roleHash });
              log(`  - Found role: ${item.name} with hash ${roleHash}`);
            } catch {
              // ignore role hash failures for this item
            }
          }
        }

        // Build role ownership information
        const rolesHeldByDeployer: RoleInfo[] = [];
        const rolesHeldByGovernance: RoleInfo[] = [];

        for (const role of roles) {
          try {
            if (await contract.hasRole(role.hash, deployer)) {
              rolesHeldByDeployer.push(role);
              log(`    Deployer HAS role ${role.name}`);
            }
          } catch {}

          try {
            if (await contract.hasRole(role.hash, governanceMultisig)) {
              rolesHeldByGovernance.push(role);
              log(`    Governance HAS role ${role.name}`);
            }
          } catch {}
        }

        const defaultAdmin = roles.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
        let governanceHasDefaultAdmin = false;
        if (defaultAdmin) {
          try {
            governanceHasDefaultAdmin = await contract.hasRole(defaultAdmin.hash, governanceMultisig);
            log(`    governanceHasDefaultAdmin: ${governanceHasDefaultAdmin}`);
          } catch {}
        }

        rolesContracts.push({
          name: contractName,
          address: contractAddress,
          abi,
          roles,
          rolesHeldByDeployer,
          rolesHeldByGovernance,
          defaultAdminRoleHash: defaultAdmin?.hash,
          governanceHasDefaultAdmin,
        });
      }

      if (ownerFn && contractInstance) {
        try {
          const contract = contractInstance as any;
          const owner: string = await contract.owner();
          log(`  Contract ${contractName} appears to be Ownable. owner=${owner}`);
          ownableContracts.push({
            name: contractName,
            address: contractAddress,
            abi,
            owner,
            deployerIsOwner: owner.toLowerCase() === deployer.toLowerCase(),
          });
        } catch {
          // ignore owner resolution failures
        }
      }
    } catch {
      // ignore malformed artifact
    }
  }

  return { rolesContracts, ownableContracts };
}
