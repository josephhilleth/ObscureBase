import { FhevmType } from "@fhevm/hardhat-plugin";
import { Wallet } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:doc-address", "Prints the EncryptedDocumentVault address").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { deployments } = hre;
  const deployment = await deployments.get("EncryptedDocumentVault");
  console.log("EncryptedDocumentVault address:", deployment.address);
});

task("task:create-doc", "Create a document with an encrypted access key")
  .addParam("name", "Document name")
  .addOptionalParam("body", "Already-encrypted body (defaults to empty string)", "")
  .addOptionalParam("accesskey", "Existing access key address; random when omitted")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const [creator] = await ethers.getSigners();

    const vault = await deployments.get("EncryptedDocumentVault");
    await fhevm.initializeCLIApi();

    const rawKey =
      typeof taskArguments.accesskey === "string" && taskArguments.accesskey.length > 0
        ? taskArguments.accesskey
        : Wallet.createRandom().address;

    const encryptedKey = await fhevm.createEncryptedInput(vault.address, creator.address).addAddress(rawKey).encrypt();

    const contract = await ethers.getContractAt("EncryptedDocumentVault", vault.address);
    const tx = await contract
      .connect(creator)
      .createDocument(taskArguments.name, taskArguments.body ?? "", encryptedKey.handles[0], encryptedKey.inputProof);
    const receipt = await tx.wait();

    console.log(`Created document with key ${rawKey}`);
    console.log("tx:", receipt?.hash);
  });

task("task:decrypt-key", "Decrypt a document access key (caller must be allowed)")
  .addParam("id", "Document id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const [caller] = await ethers.getSigners();

    await fhevm.initializeCLIApi();
    const vault = await deployments.get("EncryptedDocumentVault");
    const contract = await ethers.getContractAt("EncryptedDocumentVault", vault.address);

    const documentId = BigInt(taskArguments.id);
    const document = await contract.getDocument(documentId);

    const decryptedKey = await fhevm.userDecryptEaddress(
      FhevmType.eaddress,
      document.accessKey,
      vault.address,
      caller,
    );

    console.log("Document", documentId, "name:", document.name);
    console.log("Access key:", decryptedKey);
  });

task("task:grant-access", "Grant document access to another account")
  .addParam("id", "Document id")
  .addParam("grantee", "Address to grant")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const [caller] = await ethers.getSigners();

    const vault = await deployments.get("EncryptedDocumentVault");
    const contract = await ethers.getContractAt("EncryptedDocumentVault", vault.address);

    const tx = await contract.connect(caller).grantAccess(BigInt(taskArguments.id), taskArguments.grantee);
    const receipt = await tx.wait();

    console.log(`Granted access for doc ${taskArguments.id} to ${taskArguments.grantee}`);
    console.log("tx:", receipt?.hash);
  });
