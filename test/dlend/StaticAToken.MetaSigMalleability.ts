import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { AbiCoder, HDNodeWallet, Signature, Wallet } from "ethers";
import hre, { ethers } from "hardhat";

import { ERC20StablecoinUpgradeable, StaticATokenFactory, StaticATokenLM } from "../../typechain-types";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

// secp256k1 curve order (n)
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

describe("StaticATokenLM – Signature malleability guard", () => {
  let deployer: SignerWithAddress;
  let depositor: SignerWithAddress;
  let relayer: SignerWithAddress;
  let fixture: DLendFixtureResult;
  let staticToken: StaticATokenLM;
  let underlyingToken: ERC20StablecoinUpgradeable;
  let depositAmount: bigint;
  let deadline: bigint;
  let depositorWallet: HDNodeWallet;

  beforeEach(async () => {
    // Load full dLend fixture (deploy contracts & reserves)
    fixture = await dLendFixture();

    const named = await hre.getNamedAccounts();
    deployer = await ethers.getSigner(named.deployer);
    depositor = await ethers.getSigner(named.user1);
    relayer = await ethers.getSigner(named.user2);

    // Pick dS dStable as underlying to wrap
    const underlying = fixture.dStables.dS;
    const pool = fixture.contracts.pool;

    // Deploy wrapper through factory
    const Factory = await ethers.getContractFactory("StaticATokenFactory");
    const factory = (await Factory.connect(deployer).deploy(await pool.getAddress())) as StaticATokenFactory;

    await factory.createStaticATokens([underlying]);
    const staticAddress = await factory.getStaticAToken(underlying);
    staticToken = (await ethers.getContractAt("StaticATokenLM", staticAddress)) as StaticATokenLM;

    // Get underlying & aToken contracts
    underlyingToken = await ethers.getContractAt("ERC20StablecoinUpgradeable", underlying);

    // Fund depositor with some underlying & setup allowance
    const dec = await underlyingToken.decimals();
    depositAmount = ethers.parseUnits("100", dec);
    await underlyingToken.connect(deployer).transfer(depositor.address, depositAmount);

    // Align deadline relative to current chain time to avoid drifting when other tests warp timestamps
    const latestBlock = await ethers.provider.getBlock("latest");
    if (!latestBlock) {
      throw new Error("unable to fetch latest block");
    }
    deadline = BigInt(latestBlock.timestamp + 3600);

    // Create fresh wallet with private key and fund it
    depositorWallet = Wallet.createRandom().connect(ethers.provider) as HDNodeWallet;
    // Send ETH for gas
    await deployer.sendTransaction({
      to: await depositorWallet.getAddress(),
      value: ethers.parseEther("1"),
    });
    // Transfer underlying tokens to wallet
    await underlyingToken.connect(deployer).transfer(await depositorWallet.getAddress(), depositAmount);

    // Approve Pool to pull underlying and convert to aTokens up-front
    const poolAddress = await pool.getAddress();
    await underlyingToken.connect(depositorWallet).approve(poolAddress, depositAmount);
    await pool.connect(depositorWallet).deposit(underlying, depositAmount, await depositorWallet.getAddress(), 0);

    // Approve StaticAToken to pull pre-minted aTokens during metaDeposit
    const aTokenAddress = await staticToken.aToken();
    const aToken = await ethers.getContractAt("ERC20StablecoinUpgradeable", aTokenAddress);
    await aToken.connect(depositorWallet).approve(staticAddress, depositAmount);

    // Override depositor signer reference to wallet
    depositor = depositorWallet as unknown as SignerWithAddress;
  });

  type SigTriple = { r: string; s: string; v: number };

  /**
   *
   * @param orig
   */
  function malleateSignature(orig: Signature): SigTriple {
    const sBig = BigInt(orig.s);
    const sPrime = SECP256K1_N - sBig;
    const vPrime = orig.v === 27 ? 28 : 27; // toggle between canonical values

    const sPrimeHex = "0x" + sPrime.toString(16).padStart(64, "0");
    return { r: orig.r, s: sPrimeHex, v: vPrime };
  }

  it("rejects malleated metaDeposit & accepts canonical one", async () => {
    const nonce = await staticToken.nonces(await depositorWallet.getAddress());
    const depositToAave = false;

    const permitPlaceholder = {
      owner: ethers.ZeroAddress,
      spender: ethers.ZeroAddress,
      value: 0,
      deadline: 0,
      v: 0,
      r: ethers.ZeroHash,
      s: ethers.ZeroHash,
    } as const;

    const depositTypeHash = await staticToken.METADEPOSIT_TYPEHASH();
    const domainSeparator = await staticToken.DOMAIN_SEPARATOR();

    const abi = new AbiCoder();

    const structEncoded = abi.encode(
      [
        "bytes32",
        "address",
        "address",
        "uint256",
        "uint16",
        "bool",
        "uint256",
        "uint256",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint8",
        "bytes32",
        "bytes32",
      ],
      [
        depositTypeHash,
        await depositorWallet.getAddress(),
        await depositorWallet.getAddress(),
        depositAmount,
        0,
        depositToAave,
        nonce,
        deadline,
        permitPlaceholder.owner,
        permitPlaceholder.spender,
        permitPlaceholder.value,
        permitPlaceholder.deadline,
        permitPlaceholder.v,
        permitPlaceholder.r,
        permitPlaceholder.s,
      ],
    );

    const structHash = ethers.keccak256(structEncoded);
    const digest = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domainSeparator, structHash]));

    const sigFlat = depositorWallet.signingKey.sign(digest).serialized;
    const sig = Signature.from(sigFlat);

    // Build malleated signature
    const malSig = malleateSignature(sig);

    // Prepare params objects for contract call
    const sigParamsMal = {
      v: malSig.v,
      r: malSig.r,
      s: malSig.s,
    } as const;
    const sigParamsGood = {
      v: sig.v,
      r: sig.r,
      s: sig.s,
    };

    // First, malleated tx should revert
    await expect(
      (staticToken as any)
        .connect(relayer)
        .metaDeposit(depositor.address, depositor.address, depositAmount, 0, depositToAave, deadline, permitPlaceholder, sigParamsMal),
    ).to.be.reverted;

    // Canonical tx should succeed
    await expect(
      (staticToken as any)
        .connect(relayer)
        .metaDeposit(depositor.address, depositor.address, depositAmount, 0, depositToAave, deadline, permitPlaceholder, sigParamsGood),
    ).to.emit(staticToken, "Deposit");
  });
});
