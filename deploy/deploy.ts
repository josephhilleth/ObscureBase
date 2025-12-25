import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedVault = await deploy("EncryptedDocumentVault", {
    from: deployer,
    log: true,
  });

  console.log(`EncryptedDocumentVault contract: `, deployedVault.address);
};
export default func;
func.id = "deploy_encryptedDocumentVault"; // id required to prevent reexecution
func.tags = ["EncryptedDocumentVault"];
