import { id as keccakId, ZeroHash } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { parseBooleanEnv } from "./common";

/*
 * Comprehensive admin-handover from the governance Safe to the OZ TimelockController.
 *
 * v3 supersedes v1/v2. v2 staged the queue in 4 chunks (A=25 grants, B=20, C=26, D=1) covering only
 * DEFAULT_ADMIN_ROLE + Ownable + the two ACL helpers (POOL_ADMIN, RISK_ADMIN). v3 ALSO migrates the
 * 25 non-DEFAULT_ADMIN functional role/contract pairs the Safe still held after v2 (verified
 * on-chain): ADAPTER_MANAGER, CONFIG_MANAGER, PAUSER, STRATEGY_REBALANCER, VAULT_MANAGER on both
 * DStakeRouters; FEE_MANAGER on both DStakeTokens; ORACLE_MANAGER on 7 oracle wrappers; COLLATERAL_
 * MANAGER on both CollateralHolderVaults; AMO_INCREASE + AMO_DECREASE on dUSD_AmoManagerV2; PAUSER
 * + REDEMPTION_MANAGER on dUSD_RedeemerV2.
 *
 * REJECT-THEN-RESTAGE: queue nonces from v2 (Safe nonces 69-72) are unexecuted. Before signing
 * this script's output, reject all four in the Safe UI ("Reject" button → 0-value self-tx at the
 * same nonce). Once those rejection txns execute, the queue is clear and the 5 batches below sign
 * at the next nonces in order.
 *
 * Scope (every dLEND + dStable + dStake + Oracle surface where the Safe is currently owner, holds
 * DEFAULT_ADMIN_ROLE, or holds a functional role):
 *   - Ownable contracts          -> transferOwnership(timelock)
 *   - AccessControl DEFAULT_ADMIN -> grantRole(timelock, if missing) + revokeRole(safe)
 *   - AccessControl FUNCTIONAL    -> grantRole(timelock, if missing) + revokeRole(safe)
 *   - ACLManager specifically    -> revokeRole(POOL_ADMIN, safe) + revokeRole(RISK_ADMIN, safe)
 *                                   + revokeRole(DEFAULT_ADMIN, safe) [queued LAST]
 *
 * Order discipline (per-contract): all grants happen in Chunk A; all functional revokes happen in
 * Chunk B; DEFAULT_ADMIN revokes happen in Chunks C–E. So on any single contract, every functional
 * revoke executes while the Safe still holds DEFAULT_ADMIN_ROLE (authority to authorize the
 * revoke). Chunk E is the Safe's last admin action.
 *
 * After all five batches execute, the Safe loses every admin/owner/manager power on the protocol.
 * It retains PROPOSER + EXECUTOR + CANCELLER on the timelock, so it can still drive every change
 * via scheduleBatch (24h delay) → executeBatch.
 */

const TIMELOCK = "0x18CB0EB73D953eD20F2157ce6bDE2A85E30e681B";

// ── Ownable contracts: Safe -> transferOwnership(timelock) ──
const OWNABLE_TARGETS: ReadonlyArray<{ name: string; address: string }> = [
  { name: "AtomicMarketListingHelper", address: "0xE2FB25DBA7Be982c0B6A2C33e808c4DFc6A90fBC" },
  { name: "DefaultProxyAdmin", address: "0xBe90dB309B80357631069b689FC3481aCa2c65BE" },
  { name: "EmissionManager", address: "0xCEA995Daf89500FE165bc86D829552B03A1d1396" },
  { name: "PoolAddressesProvider", address: "0xa5CaE880272183d7C8B69F8B0edF395f8E42e751" },
  { name: "PoolAddressesProviderRegistry", address: "0xfdb85fDFCEE413EB05287f9D4157c1EF1F336207" },
  { name: "ReservesSetupHelper", address: "0x4D4624aF28D4C4bcAd937491E697Da7FC738f30E" },
  { name: "TreasuryController", address: "0x3b73627Dd377f86f312150401531916b6b2Eb508" },
  { name: "WrappedTokenGatewayV3", address: "0xb1C1d6150c4F072f5426Aa918f7924EE73C6ac2d" },
];

// ── AccessControl contracts: Safe holds DEFAULT_ADMIN_ROLE -> grant TL (if missing) + revoke Safe ──
// ACLManager is handled separately so its DEFAULT_ADMIN revoke is queued LAST (Chunk E).
const ACL_MANAGER = "0x80F7023e25a32E4A020ed71346c0f37C10589609";
const ACCESS_CONTROL_TARGETS: ReadonlyArray<{ name: string; address: string }> = [
  { name: "DStakeCollateralVaultV2_sdETH", address: "0xf93Fb0aDd57133AecD56fA48350684B5A7A1A5b9" },
  { name: "DStakeCollateralVaultV2_sdUSD", address: "0x4aCBcFa29fb085097c5f31783403EF7A7930F6Fe" },
  { name: "DStakeIdleVault_sdETH", address: "0x501CE63871F9Bb20620233D22D0D4F539fe8A9a1" },
  { name: "DStakeIdleVault_sdUSD", address: "0x78a4DAD0AC32c80Da6eF60a366b1C035145380bc" },
  { name: "DStakeRewardManagerDLend_sdETH", address: "0x93d2e552f0aC25927Bbd3f6C71CaB43B73A3ACdF" },
  { name: "DStakeRewardManagerDLend_sdUSD", address: "0x5D5543e671652a5871331d28357064CAc02A9e7e" },
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8" },
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a" },
  { name: "DStakeTokenV2_sdETH", address: "0x20b1884c9347BEBC13E9aca1965c5Ae56b0a8590" },
  { name: "DStakeTokenV2_sdUSD", address: "0x7CB20517776636eD76b68EdB3D99DCce356ABf02" },
  { name: "ETH_ERC4626OracleWrapper", address: "0x889bf3E00e93Bc9CE17A7f8141ef109283913f37" },
  { name: "ETH_OracleAggregator", address: "0xC40f4303505320F782972ad4756eD2A7390a9d9C" },
  { name: "ETH_RedstoneWrapper", address: "0xE38F8BcEB6F8794e2b025DED1E923f30B58361B3" },
  { name: "GenericERC4626ConversionAdapter_sdETH", address: "0xA51FA58c76D92F1b0D4D6E3b88d2ba0afF2C2b56" },
  { name: "GenericERC4626ConversionAdapter_sdUSD", address: "0xefd794E2D8024F3C25aA343588dd6D4481b5Db7c" },
  { name: "USD_ChainlinkERC4626Wrapper", address: "0x4188019CC2339C68D1F097678AF96d1915a6c681" },
  { name: "USD_OracleAggregator", address: "0x02165D665E171566629822d9380aD93b975B186c" },
  { name: "USD_RedstoneChainlinkCompositeWrapperWithThresholding", address: "0x7BC5Dd97396c765fe5ffA65c58Cdd2ED46D0a1C8" },
  { name: "USD_RedstoneChainlinkWrapper", address: "0xdd777d9B3B31F6a72331d1E81c64B9FFbBa44358" },
  { name: "USD_RedstoneChainlinkWrapperWithThresholding", address: "0xC58c48336651b074bcE5bE65df0F292fe3707f59" },
  { name: "WrappedDLendConversionAdapter_sdETH", address: "0xD07072330f4d814f9943bC4066Abd3C3ee48Fb07" },
  { name: "WrappedDLendConversionAdapter_sdUSD", address: "0x1A5BB485c58A86c193b823D0eA031b68813e100F" },
  { name: "dETH", address: "0xb419ecdd222981e7e54cec316797ecb799c6afdc" },
  { name: "dETH_AmoDebtToken", address: "0x88e49F238Ea53b2A18B6d947e68223E353aaaA38" },
  { name: "dETH_AmoManagerV2", address: "0xBc53406583D4370Ea4a5dc2bfd5592EF9Cea56A7" },
  { name: "dETH_CollateralHolderVault", address: "0x349EE07146157648D40fD471380B510B4D56A2F2" },
  { name: "dETH_IssuerV2_2", address: "0x70BFBE78548f1159CB9B453e4d6AD0E3648a5a8D" },
  { name: "dETH_Redeemer", address: "0xd66C168fB7f3e04654082534c87b6544e6036CaC" },
  { name: "dETH_RedeemerV2", address: "0xdc43d538935D187864b21997f8Ad05de66aFAe4B" },
  { name: "dUSD", address: "0x07fFf99e1664d9B116fbC158c0E99785F81cA236" },
  { name: "dUSD_AmoDebtToken", address: "0x55a626E2f9DF98eC09A8898363c26bcB396b098d" },
  { name: "dUSD_AmoManagerV2", address: "0x29532F74A9302e0a1E9f7d015FE355FFdE6e6880" },
  { name: "dUSD_CollateralHolderVault", address: "0x84c58066a4408454b7380f168c95F571419253f4" },
  { name: "dUSD_IssuerV2_2", address: "0xF84Cc8217713A53Fc3e3eB2D62D2Af33a084FF85" },
  { name: "dUSD_Redeemer", address: "0x683F183070ee9c12B25618DB3483266888Ce9809" },
  { name: "dUSD_RedeemerV2", address: "0x093e9dB2C2eC21ff7E5E1F5766Bbfb48B7BA90cD" },
];

const POOL_ADMIN_ROLE = keccakId("POOL_ADMIN");
const RISK_ADMIN_ROLE = keccakId("RISK_ADMIN");

// Functional (non-DEFAULT_ADMIN) roles still held by the Safe after v2 — verified on-chain.
const ROLE_HASHES: Readonly<Record<string, string>> = {
  ADAPTER_MANAGER_ROLE: keccakId("ADAPTER_MANAGER_ROLE"),
  CONFIG_MANAGER_ROLE: keccakId("CONFIG_MANAGER_ROLE"),
  PAUSER_ROLE: keccakId("PAUSER_ROLE"),
  STRATEGY_REBALANCER_ROLE: keccakId("STRATEGY_REBALANCER_ROLE"),
  VAULT_MANAGER_ROLE: keccakId("VAULT_MANAGER_ROLE"),
  FEE_MANAGER_ROLE: keccakId("FEE_MANAGER_ROLE"),
  ORACLE_MANAGER_ROLE: keccakId("ORACLE_MANAGER_ROLE"),
  COLLATERAL_MANAGER_ROLE: keccakId("COLLATERAL_MANAGER_ROLE"),
  AMO_INCREASE_ROLE: keccakId("AMO_INCREASE_ROLE"),
  AMO_DECREASE_ROLE: keccakId("AMO_DECREASE_ROLE"),
  REDEMPTION_MANAGER_ROLE: keccakId("REDEMPTION_MANAGER_ROLE"),
};

// 25 functional role/contract pairs the Safe holds. Reference reconciliation done via cast call at
// block ~25,191,384 — see `scripts/roles/scan-roles-safe.ts` and the docs/post-mortem.
const FUNCTIONAL_ROLE_TARGETS: ReadonlyArray<{ name: string; address: string; role: keyof typeof ROLE_HASHES }> = [
  // DStakeRouterV2_sdETH (5)
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8", role: "ADAPTER_MANAGER_ROLE" },
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8", role: "CONFIG_MANAGER_ROLE" },
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8", role: "PAUSER_ROLE" },
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8", role: "STRATEGY_REBALANCER_ROLE" },
  { name: "DStakeRouterV2_sdETH", address: "0x2E89DF2934AFF1B671923a45BaCF2b21f3cf64A8", role: "VAULT_MANAGER_ROLE" },
  // DStakeRouterV2_sdUSD (5)
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a", role: "ADAPTER_MANAGER_ROLE" },
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a", role: "CONFIG_MANAGER_ROLE" },
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a", role: "PAUSER_ROLE" },
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a", role: "STRATEGY_REBALANCER_ROLE" },
  { name: "DStakeRouterV2_sdUSD", address: "0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a", role: "VAULT_MANAGER_ROLE" },
  // DStakeTokens (2)
  { name: "DStakeTokenV2_sdETH", address: "0x20b1884c9347BEBC13E9aca1965c5Ae56b0a8590", role: "FEE_MANAGER_ROLE" },
  { name: "DStakeTokenV2_sdUSD", address: "0x7CB20517776636eD76b68EdB3D99DCce356ABf02", role: "FEE_MANAGER_ROLE" },
  // Oracles (7)
  { name: "ETH_ERC4626OracleWrapper", address: "0x889bf3E00e93Bc9CE17A7f8141ef109283913f37", role: "ORACLE_MANAGER_ROLE" },
  { name: "ETH_OracleAggregator", address: "0xC40f4303505320F782972ad4756eD2A7390a9d9C", role: "ORACLE_MANAGER_ROLE" },
  { name: "ETH_RedstoneWrapper", address: "0xE38F8BcEB6F8794e2b025DED1E923f30B58361B3", role: "ORACLE_MANAGER_ROLE" },
  { name: "USD_ChainlinkERC4626Wrapper", address: "0x4188019CC2339C68D1F097678AF96d1915a6c681", role: "ORACLE_MANAGER_ROLE" },
  { name: "USD_OracleAggregator", address: "0x02165D665E171566629822d9380aD93b975B186c", role: "ORACLE_MANAGER_ROLE" },
  {
    name: "USD_RedstoneChainlinkCompositeWrapperWithThresholding",
    address: "0x7BC5Dd97396c765fe5ffA65c58Cdd2ED46D0a1C8",
    role: "ORACLE_MANAGER_ROLE",
  },
  { name: "USD_RedstoneChainlinkWrapper", address: "0xdd777d9B3B31F6a72331d1E81c64B9FFbBa44358", role: "ORACLE_MANAGER_ROLE" },
  // CollateralHolderVaults (2)
  { name: "dETH_CollateralHolderVault", address: "0x349EE07146157648D40fD471380B510B4D56A2F2", role: "COLLATERAL_MANAGER_ROLE" },
  { name: "dUSD_CollateralHolderVault", address: "0x84c58066a4408454b7380f168c95F571419253f4", role: "COLLATERAL_MANAGER_ROLE" },
  // dUSD_AmoManagerV2 (2)
  { name: "dUSD_AmoManagerV2", address: "0x29532F74A9302e0a1E9f7d015FE355FFdE6e6880", role: "AMO_INCREASE_ROLE" },
  { name: "dUSD_AmoManagerV2", address: "0x29532F74A9302e0a1E9f7d015FE355FFdE6e6880", role: "AMO_DECREASE_ROLE" },
  // dUSD_RedeemerV2 (2)
  { name: "dUSD_RedeemerV2", address: "0x093e9dB2C2eC21ff7E5E1F5766Bbfb48B7BA90cD", role: "PAUSER_ROLE" },
  { name: "dUSD_RedeemerV2", address: "0x093e9dB2C2eC21ff7E5E1F5766Bbfb48B7BA90cD", role: "REDEMPTION_MANAGER_ROLE" },
];

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
];
const OWNABLE_ABI = ["function owner() view returns (address)", "function transferOwnership(address newOwner)"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-admin-handover-safe: local network detected – skipping");
    return true;
  }

  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!parseBooleanEnv("HANDOVER_TIMELOCK_ACK", false)) {
    throw new Error(
      "Set HANDOVER_TIMELOCK_ACK=true only when ALL admin / owner / manager powers should be migrated from the Safe to the timelock.",
    );
  }

  if (!parseBooleanEnv("HANDOVER_MONITORING_ACK", false)) {
    throw new Error("Set HANDOVER_MONITORING_ACK=true only after monitoring/alerting is live for the handover window.");
  }

  const safe = config.safeConfig!.safeAddress;
  const aclIface = new ethers.Interface(ACCESS_CONTROL_ABI);
  const ownIface = new ethers.Interface(OWNABLE_ABI);

  // Run a single "chunk" as its own Safe batch (so the full 117-op handover splits cleanly into 5
  // small batches the Safe UI can render without hitting its MultiSend memory cap).
  const runChunk = async (
    description: string,
    build: (enqueue: (to: string, data: string) => Promise<void>) => Promise<number>,
  ): Promise<void> => {
    const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

    if (!executor.useSafe) {
      throw new Error("Safe config is required for the admin handover.");
    }
    await executor.initialize();

    const enqueue = async (to: string, data: string): Promise<void> => {
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to, value: "0", data }),
      );
    };
    const count = await build(enqueue);

    if (count === 0) {
      console.log(`  (skipping empty chunk: ${description})`);
      return;
    }
    const ok = await executor.flush(description);

    if (!ok) {
      throw new Error(`Failed to flush chunk: ${description}`);
    }
    console.log(`  ✅ ${description}: ${count} ops`);
  };

  let opCount = 0;

  // Split the 36-entry AccessControl DEFAULT_ADMIN revoke set in half so neither Chunk C nor D
  // exceeds ~30 ops (well under the Safe UI ~11kB MultiSend memory cap seen at 72 ops in v1).
  const mid = Math.ceil(ACCESS_CONTROL_TARGETS.length / 2);
  const firstHalf = ACCESS_CONTROL_TARGETS.slice(0, mid);
  const secondHalf = ACCESS_CONTROL_TARGETS.slice(mid);

  // ── CHUNK A: ALL grants (DEFAULT_ADMIN + functional) ──
  console.log("─── Chunk A: grantRole(*, timelock) where missing ───");
  await runChunk("dLEND admin handover A: grant timelock all admin + functional roles", async (enqueue) => {
    let n = 0;

    // A.1 DEFAULT_ADMIN_ROLE grants
    for (const t of ACCESS_CONTROL_TARGETS) {
      const c = new ethers.Contract(t.address, ACCESS_CONTROL_ABI, signer);

      if (await c.hasRole(ZeroHash, TIMELOCK)) {
        console.log(`  ✓ ${t.name}: timelock already has DEFAULT_ADMIN_ROLE`);
        continue;
      }
      await enqueue(t.address, aclIface.encodeFunctionData("grantRole", [ZeroHash, TIMELOCK]));
      n++;
      console.log(`  + ${t.name}: grant DEFAULT_ADMIN_ROLE → timelock`);
    }

    // A.2 functional grants (skip if TL already holds it — saves gas for the 5 REVOKE-ONLY pairs)
    for (const t of FUNCTIONAL_ROLE_TARGETS) {
      const role = ROLE_HASHES[t.role];
      const c = new ethers.Contract(t.address, ACCESS_CONTROL_ABI, signer);

      if (await c.hasRole(role, TIMELOCK)) {
        console.log(`  ✓ ${t.name}.${t.role}: timelock already holds`);
        continue;
      }
      await enqueue(t.address, aclIface.encodeFunctionData("grantRole", [role, TIMELOCK]));
      n++;
      console.log(`  + ${t.name}: grant ${t.role} → timelock`);
    }
    opCount += n;
    return n;
  });

  // ── CHUNK B: ALL functional revokes from Safe ──
  // Functional revokes happen BEFORE any DEFAULT_ADMIN revoke so the Safe still has authority to
  // revoke functional roles on every contract.
  console.log("─── Chunk B: revoke all functional roles from Safe ───");
  await runChunk("dLEND admin handover B: revoke functional roles from Safe", async (enqueue) => {
    let n = 0;

    for (const t of FUNCTIONAL_ROLE_TARGETS) {
      const role = ROLE_HASHES[t.role];
      const c = new ethers.Contract(t.address, ACCESS_CONTROL_ABI, signer);

      if (!(await c.hasRole(role, safe))) {
        console.log(`  ✓ ${t.name}.${t.role}: Safe already revoked`);
        continue;
      }
      await enqueue(t.address, aclIface.encodeFunctionData("revokeRole", [role, safe]));
      n++;
      console.log(`  − ${t.name}: revoke ${t.role} from Safe`);
    }
    opCount += n;
    return n;
  });

  // ── CHUNK C: ACL helpers + first-half DEFAULT_ADMIN revokes ──
  console.log("─── Chunk C: revoke POOL_ADMIN/RISK_ADMIN on ACL + first-half DEFAULT_ADMIN revokes ───");
  await runChunk("dLEND admin handover C: revoke ACL helpers + first-half DEFAULT_ADMIN revokes", async (enqueue) => {
    let n = 0;
    const acl = new ethers.Contract(ACL_MANAGER, ACCESS_CONTROL_ABI, signer);

    if (await acl.hasRole(POOL_ADMIN_ROLE, safe)) {
      await enqueue(ACL_MANAGER, aclIface.encodeFunctionData("revokeRole", [POOL_ADMIN_ROLE, safe]));
      n++;
      console.log("  − ACLManager: revokeRole(POOL_ADMIN_ROLE, Safe)");
    }

    if (await acl.hasRole(RISK_ADMIN_ROLE, safe)) {
      await enqueue(ACL_MANAGER, aclIface.encodeFunctionData("revokeRole", [RISK_ADMIN_ROLE, safe]));
      n++;
      console.log("  − ACLManager: revokeRole(RISK_ADMIN_ROLE, Safe)");
    }

    for (const t of firstHalf) {
      const c = new ethers.Contract(t.address, ACCESS_CONTROL_ABI, signer);

      if (!(await c.hasRole(ZeroHash, safe))) {
        continue;
      }
      await enqueue(t.address, aclIface.encodeFunctionData("revokeRole", [ZeroHash, safe]));
      n++;
      console.log(`  − ${t.name}: revokeRole(DEFAULT_ADMIN_ROLE, Safe)`);
    }
    opCount += n;
    return n;
  });

  // ── CHUNK D: second-half DEFAULT_ADMIN revokes + Ownable transferOwnerships ──
  console.log("─── Chunk D: second-half DEFAULT_ADMIN revokes + Ownable transferOwnership ───");
  await runChunk("dLEND admin handover D: second-half DEFAULT_ADMIN revokes + Ownable transferOwnership", async (enqueue) => {
    let n = 0;

    for (const t of secondHalf) {
      const c = new ethers.Contract(t.address, ACCESS_CONTROL_ABI, signer);

      if (!(await c.hasRole(ZeroHash, safe))) {
        continue;
      }
      await enqueue(t.address, aclIface.encodeFunctionData("revokeRole", [ZeroHash, safe]));
      n++;
      console.log(`  − ${t.name}: revokeRole(DEFAULT_ADMIN_ROLE, Safe)`);
    }

    for (const t of OWNABLE_TARGETS) {
      const c = new ethers.Contract(t.address, OWNABLE_ABI, signer);
      const owner: string = await c.owner();

      if (owner.toLowerCase() !== safe.toLowerCase()) {
        console.log(`  ✓ ${t.name}: owner is ${owner} (not Safe) — skipping`);
        continue;
      }
      await enqueue(t.address, ownIface.encodeFunctionData("transferOwnership", [TIMELOCK]));
      n++;
      console.log(`  → ${t.name}: transferOwnership(timelock)`);
    }
    opCount += n;
    return n;
  });

  // ── CHUNK E: FINAL ACL DEFAULT_ADMIN_ROLE revoke ──
  console.log("─── Chunk E: ACL DEFAULT_ADMIN_ROLE revoke (Safe's final admin action) ───");
  await runChunk("dLEND admin handover E: ACL DEFAULT_ADMIN_ROLE revoke (FINAL)", async (enqueue) => {
    const acl = new ethers.Contract(ACL_MANAGER, ACCESS_CONTROL_ABI, signer);

    if (!(await acl.hasRole(ZeroHash, safe))) {
      console.log("  ✓ ACLManager: Safe no longer has DEFAULT_ADMIN_ROLE");
      return 0;
    }
    await enqueue(ACL_MANAGER, aclIface.encodeFunctionData("revokeRole", [ZeroHash, safe]));
    console.log("  − ACLManager: revokeRole(DEFAULT_ADMIN_ROLE, Safe)  [FINAL]");
    opCount += 1;
    return 1;
  });

  console.log(`🔁 setup-ethereum-mainnet-admin-handover-safe (v3): ✅ ${opCount} ops queued across 5 batches`);
  console.log("");
  console.log("  ➜ NEXT STEP — reject the v2 queue (nonces 69-72) in the Safe UI before signing the 5");
  console.log("    new batches, so the new batches sign at the next available nonces in order.");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-admin-handover-safe"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "setup-ethereum-mainnet-admin-handover-safe-v3";

export default func;
