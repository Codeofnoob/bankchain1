import { ethers } from "hardhat";

/**
 * Deploy flow:
 * 1) KYCRegistry(admin)
 * 2) DepositToken(admin, kyc) + grant MINTER_ROLE to BankVault
 * 3) BankVault(admin, token, kyc)
 * 4) LendingPool(admin, token, kyc)
 * 5) Mark vault + lending as "system addresses" in the token (they can hold BKD without KYC)
 * 6) Seed demo: approve KYC for a couple accounts; mint some BKD by depositing ETH
 */
async function main() {
  const [admin, alice, bob] = await ethers.getSigners();

  console.log("Admin:", admin.address);
  console.log("Alice:", alice.address);
  console.log("Bob:", bob.address);

  const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
  const kyc = await KYCRegistry.deploy(admin.address);
  await kyc.waitForDeployment();

  const DepositToken = await ethers.getContractFactory("DepositToken");
  const token = await DepositToken.deploy(admin.address, await kyc.getAddress());
  await token.waitForDeployment();

  const BankVault = await ethers.getContractFactory("BankVault");
  const vault = await BankVault.deploy(admin.address, await token.getAddress(), await kyc.getAddress());
  await vault.waitForDeployment();

  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lending = await LendingPool.deploy(admin.address, await token.getAddress(), await kyc.getAddress());
  await lending.waitForDeployment();

  // Grant MINTER_ROLE to the vault so it can mint/burn BKD.
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await (await token.grantRole(MINTER_ROLE, await vault.getAddress())).wait();

  // Mark system addresses (vault & lending) so they can receive/hold BKD without KYC.
  await (await token.setSystemAddress(await vault.getAddress(), true)).wait();
  await (await token.setSystemAddress(await lending.getAddress(), true)).wait();

  // Approve KYC for demo users
  // Seed: create on-chain KYC requests then approve them
const aliceHash = ethers.keccak256(ethers.toUtf8Bytes("seed:alice:kyc"));
const bobHash   = ethers.keccak256(ethers.toUtf8Bytes("seed:bob:kyc"));

await (await kyc.connect(alice).requestKYC(aliceHash)).wait();
await (await kyc.connect(bob).requestKYC(bobHash)).wait();

await (await kyc.approveFromRequest(alice.address, 1, 0)).wait(); // level 1, no expiry
await (await kyc.approveFromRequest(bob.address, 1, 0)).wait();

  // Alice deposits 1 ETH and gets 1 BKD (in wei)
  await (await vault.connect(alice).deposit({ value: ethers.parseEther("1.0") })).wait();

  // Bob deposits 0.5 ETH
  await (await vault.connect(bob).deposit({ value: ethers.parseEther("0.5") })).wait();

  // Approve vault spending for transfers and lending flows
  await (await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(alice).approve(await lending.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(bob).approve(await lending.getAddress(), ethers.MaxUint256)).wait();

  // Alice transfers 0.1 ETH worth of BKD to Bob via compliance-gated method
  await (await vault.connect(alice).transferBKD(bob.address, ethers.parseEther("0.1"))).wait();

  // Alice uses 0.3 BKD as collateral and borrows 0.1 BKD
  await (await lending.connect(alice).depositCollateral(ethers.parseEther("0.3"))).wait();
  await (await lending.connect(alice).borrow(ethers.parseEther("0.1"))).wait();

  console.log("\nDeployed addresses:");
  console.log("KYCRegistry:", await kyc.getAddress());
  console.log("DepositToken:", await token.getAddress());
  console.log("BankVault:", await vault.getAddress());
  console.log("LendingPool:", await lending.getAddress());

  // Write addresses for backend/frontend consumption
  const fs = await import("fs");
  const path = await import("path");
  const out = {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    contracts: {
      KYCRegistry: await kyc.getAddress(),
      DepositToken: await token.getAddress(),
      BankVault: await vault.getAddress(),
      LendingPool: await lending.getAddress(),
    },
  };
  const outPath = path.join(__dirname, "..", "..", "contracts.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("\nWrote:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
