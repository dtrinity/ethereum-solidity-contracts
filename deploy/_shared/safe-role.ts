import { BaseContract } from "ethers";
import { DeployFunction } from "hardhat-deploy/types";

import { GovernanceExecutor } from "../../typescript/hardhat/governance";

type AccessControlLike = BaseContract & {
  hasRole(role: string, account: string): Promise<boolean>;
  getRoleAdmin(role: string): Promise<string>;
  interface: {
    encodeFunctionData(name: string, values?: readonly unknown[]): string;
  };
};

export type RoleAccess = {
  hasRole: boolean;
  canGrantRole: boolean;
  adminRole: string;
};

/**
 * Returns whether an account has a role already and whether it can self-grant that role.
 *
 * @param contract AccessControl-compatible contract.
 * @param role Target role identifier.
 * @param account Account to inspect.
 */
export async function getRoleAccess(contract: AccessControlLike, role: string, account: string): Promise<RoleAccess> {
  const [hasRole, adminRole] = await Promise.all([contract.hasRole(role, account), contract.getRoleAdmin(role)]);
  const canGrantRole = await contract.hasRole(adminRole, account);

  return {
    hasRole,
    canGrantRole,
    adminRole,
  };
}

/**
 * Ensures `managerAddress` has `role` on `contract`, queueing `grantRole` via Safe if needed.
 *
 * @param params Role grant request.
 * @param params.executor Governance executor.
 * @param params.contract AccessControl-compatible contract.
 * @param params.contractAddress Target contract address.
 * @param params.managerAddress Safe/manager address.
 * @param params.role Target role identifier.
 * @param params.roleLabel Human-readable role label.
 * @param params.contractLabel Human-readable contract label.
 */
export async function ensureRoleGrantedToManager(params: {
  executor: GovernanceExecutor;
  contract: AccessControlLike;
  contractAddress: string;
  managerAddress: string;
  role: string;
  roleLabel: string;
  contractLabel: string;
}): Promise<void> {
  const { executor, contract, contractAddress, managerAddress, role, roleLabel, contractLabel } = params;

  const access = await getRoleAccess(contract, role, managerAddress);

  if (access.hasRole) {
    return;
  }

  if (!access.canGrantRole) {
    throw new Error(
      [
        `[role-check] ${managerAddress} is missing ${roleLabel} on ${contractLabel} (${contractAddress}).`,
        `It also lacks admin role ${access.adminRole} required to grant ${roleLabel}.`,
      ].join(" "),
    );
  }

  const data = contract.interface.encodeFunctionData("grantRole", [role, managerAddress]);
  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to: contractAddress, value: "0", data }),
  );
}

/**
 * Requires `managerAddress` to already have `role` on `contract`.
 *
 * @param params Role assertion request.
 * @param params.contract AccessControl-compatible contract.
 * @param params.contractAddress Target contract address.
 * @param params.managerAddress Safe/manager address.
 * @param params.role Target role identifier.
 * @param params.roleLabel Human-readable role label.
 * @param params.contractLabel Human-readable contract label.
 */
export async function assertRoleGrantedToManager(params: {
  contract: AccessControlLike;
  contractAddress: string;
  managerAddress: string;
  role: string;
  roleLabel: string;
  contractLabel: string;
}): Promise<void> {
  const { contract, contractAddress, managerAddress, role, roleLabel, contractLabel } = params;

  const access = await getRoleAccess(contract, role, managerAddress);

  if (access.hasRole) {
    return;
  }

  throw new Error(
    [
      `[role-check] ${managerAddress} is missing ${roleLabel} on ${contractLabel} (${contractAddress}).`,
      `Run setup-ethereum-mainnet-new-listings-role-grants-safe and execute that Safe batch first.`,
    ].join(" "),
  );
}

const func: DeployFunction = async () => true;
func.skip = async (): Promise<boolean> => true;
func.id = "safe-role-helper";

export default func;

/**
 * Ensures `account` does not have `role` on `contract`, queueing `revokeRole` via Safe if needed.
 *
 * @param params Role revoke request.
 * @param params.executor Governance executor.
 * @param params.contract AccessControl-compatible contract.
 * @param params.contractAddress Target contract address.
 * @param params.managerAddress Safe/manager address (the one revoking the role).
 * @param params.account Account to revoke role from.
 * @param params.role Target role identifier.
 * @param params.roleLabel Human-readable role label.
 * @param params.contractLabel Human-readable contract label.
 */
export async function ensureRoleRevokedFromAccount(params: {
  executor: GovernanceExecutor;
  contract: AccessControlLike;
  contractAddress: string;
  managerAddress: string;
  account: string;
  role: string;
  roleLabel: string;
  contractLabel: string;
}): Promise<void> {
  const { executor, contract, contractAddress, managerAddress, account, role, roleLabel, contractLabel } = params;

  const access = await getRoleAccess(contract, role, account);

  if (!access.hasRole) {
    return;
  }

  const managerAccess = await getRoleAccess(contract, role, managerAddress);

  if (!managerAccess.canGrantRole) {
    throw new Error(
      [
        `[role-check] ${managerAddress} lacks admin role ${managerAccess.adminRole} required to revoke ${roleLabel} on ${contractLabel} (${contractAddress}).`,
      ].join(" "),
    );
  }

  const data = contract.interface.encodeFunctionData("revokeRole", [role, account]);
  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to: contractAddress, value: "0", data }),
  );
}
