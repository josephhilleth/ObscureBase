import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { EncryptedDocumentVault, EncryptedDocumentVault__factory } from "../types";

type Signers = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function encryptAccessKey(contractAddress: string, sender: HardhatEthersSigner, key: string) {
  return fhevm.createEncryptedInput(contractAddress, sender.address).addAddress(key).encrypt();
}

function toHandleHex(value: string | bigint) {
  return typeof value === "string" ? value : ethers.hexlify(value);
}

describe("EncryptedDocumentVault", function () {
  let signers: Signers;
  let vault: EncryptedDocumentVault;
  let contractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { owner: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    const factory = (await ethers.getContractFactory("EncryptedDocumentVault")) as EncryptedDocumentVault__factory;
    vault = (await factory.deploy()) as EncryptedDocumentVault;
    contractAddress = await vault.getAddress();
  });

  it("stores the encrypted key and lets the owner decrypt it", async function () {
    const key = ethers.Wallet.createRandom().address;
    const encryptedKey = await encryptAccessKey(contractAddress, signers.owner, key);

    const tx = await vault
      .connect(signers.owner)
      .createDocument("Genesis", "", encryptedKey.handles[0], encryptedKey.inputProof);
    await tx.wait();

    const stored = await vault.getDocument(1);
    const handleHex = toHandleHex(stored.accessKey);
    const decryptedKey = await fhevm.userDecryptEaddress(handleHex, contractAddress, signers.owner);

    expect(decryptedKey.toLowerCase()).to.eq(key.toLowerCase());
    expect(stored.owner).to.eq(signers.owner.address);
    expect(stored.name).to.eq("Genesis");
    expect(stored.encryptedBody).to.eq("");
  });

  it("blocks unauthorized edits until access is granted", async function () {
    const key = ethers.Wallet.createRandom().address;
    const encryptedKey = await encryptAccessKey(contractAddress, signers.owner, key);
    await vault.createDocument("Doc", "", encryptedKey.handles[0], encryptedKey.inputProof);

    await expect(vault.connect(signers.bob).updateDocumentBody(1, "ciphertext")).to.be.revertedWith(
      "Sender not authorized for key",
    );

    await vault.connect(signers.owner).grantAccess(1, signers.bob.address);
    const updateTx = await vault.connect(signers.bob).updateDocumentBody(1, "ciphertext");
    await updateTx.wait();

    const stored = await vault.getDocument(1);
    expect(stored.encryptedBody).to.eq("ciphertext");

    const shared = await vault.getSharedDocumentIds(signers.bob.address);
    expect(shared.map((value) => Number(value))).to.deep.eq([1]);
  });

  it("tracks owned documents and total count", async function () {
    const keyA = ethers.Wallet.createRandom().address;
    const keyB = ethers.Wallet.createRandom().address;

    let encryptedKey = await encryptAccessKey(contractAddress, signers.owner, keyA);
    await vault.createDocument("A", "", encryptedKey.handles[0], encryptedKey.inputProof);

    encryptedKey = await encryptAccessKey(contractAddress, signers.owner, keyB);
    await vault.createDocument("B", "payload", encryptedKey.handles[0], encryptedKey.inputProof);

    const ownedIds = await vault.getOwnedDocumentIds(signers.owner.address);
    expect(ownedIds.map((value) => Number(value))).to.deep.eq([1, 2]);

    const total = await vault.totalDocuments();
    expect(total).to.eq(2);
  });
});
