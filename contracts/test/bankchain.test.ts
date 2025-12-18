import { expect } from "chai";
import { ethers } from "hardhat";

describe("BankChain", function () {
  it("enforces KYC on vault deposits and transfers (and token-level enforcement)", async function () {
    const [admin, alice, bob, carol] = await ethers.getSigners();

    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    const kyc = await KYCRegistry.deploy(admin.address);
    await kyc.waitForDeployment();

    const DepositToken = await ethers.getContractFactory("DepositToken");
    const token = await DepositToken.deploy(admin.address, await kyc.getAddress());
    await token.waitForDeployment();

    const BankVault = await ethers.getContractFactory("BankVault");
    const vault = await BankVault.deploy(admin.address, await token.getAddress(), await kyc.getAddress());
    await vault.waitForDeployment();

    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await (await token.grantRole(MINTER_ROLE, await vault.getAddress())).wait();
    await (await token.setSystemAddress(await vault.getAddress(), true)).wait();

    // approve KYC only for alice and bob
    await (await kyc.approveKYC(alice.address)).wait();
    await (await kyc.approveKYC(bob.address)).wait();

    // Carol cannot deposit (vault-level check)
    await expect(vault.connect(carol).deposit({ value: ethers.parseEther("0.1") }))
      .to.be.revertedWithCustomError(vault, "NotKYCApproved");

    await (await vault.connect(alice).deposit({ value: ethers.parseEther("1.0") })).wait();
    await (await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256)).wait();

    // Carol cannot receive via transferBKD because not KYC (token-level check triggers, but vault also checks)
    await expect(vault.connect(alice).transferBKD(carol.address, ethers.parseEther("0.1")))
      .to.be.reverted;
  });

  it("lending respects LTV and accrues interest", async function () {
    const [admin, alice] = await ethers.getSigners();

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

    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await (await token.grantRole(MINTER_ROLE, await vault.getAddress())).wait();

    await (await token.setSystemAddress(await vault.getAddress(), true)).wait();
    await (await token.setSystemAddress(await lending.getAddress(), true)).wait();

    await (await kyc.approveKYC(alice.address)).wait();

    await (await vault.connect(alice).deposit({ value: ethers.parseEther("1.0") })).wait();
    await (await token.connect(alice).approve(await lending.getAddress(), ethers.MaxUint256)).wait();

    await (await lending.connect(alice).depositCollateral(ethers.parseEther("0.5"))).wait();
    // max borrow 50% LTV => 0.25
    await expect(lending.connect(alice).borrow(ethers.parseEther("0.3"))).to.be.revertedWithCustomError(lending, "BorrowTooLarge");
    await (await lending.connect(alice).borrow(ethers.parseEther("0.2"))).wait();

    // advance time by 1 year
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    const acct = await lending.getAccount(alice.address);
    const debt = acct[1];
    expect(debt).to.be.gt(ethers.parseEther("0.2"));
  });
});
