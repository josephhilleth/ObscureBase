# ObscureBase

ObscureBase is a non-custodial encrypted document vault built on the Zama FHEVM stack. It stores document metadata and
an encrypted access key on-chain, while document bodies are encrypted in the browser and saved on-chain as ciphertext.
Only explicitly allowed addresses can decrypt the access key and edit content.

## Introduction

ObscureBase solves the gap between public blockchain transparency and the privacy needed for sensitive documents. Instead
of putting plaintext on-chain, it uses Fully Homomorphic Encryption (FHE) to keep access keys private while still being
managed on-chain. The UI then encrypts and decrypts document bodies locally, ensuring the plaintext never leaves the
user's browser.

At a high level:
- A user creates a document by generating a random EVM address (access key A), encrypting A with Zama, and submitting the
  document name, an empty body, and the encrypted key to the contract.
- The user can later decrypt A, encrypt the document body locally, and store the ciphertext on-chain.
- The owner can grant access to other addresses; grantees can decrypt A and update the encrypted body.

## Problems This Project Solves

- **On-chain privacy**: Blockchains are transparent, so storing documents directly exposes content. ObscureBase stores only
  ciphertext, while access keys remain encrypted by FHE.
- **Secure collaboration**: Sharing access without sharing private keys is hard. ObscureBase uses on-chain permissions to
  allow specific accounts to decrypt the access key.
- **Auditability without disclosure**: Names, timestamps, and edit history are visible, while content remains private.
- **No centralized key custody**: There is no backend holding secrets; keys are decrypted in-browser only.

## Advantages

- **Non-custodial encryption**: Access keys are encrypted on-chain; plaintext never touches the contract.
- **Selective sharing**: Access can be granted per document without exposing the key to the public.
- **Client-side privacy**: Document bodies are encrypted and decrypted locally using WebCrypto.
- **Transparent metadata**: Ownership and edit history are on-chain for accountability.
- **Composable design**: The access key is an EVM address, making it easy to represent, copy, and use in tooling.
- **No local storage**: The UI keeps secrets in memory only, avoiding persistence risks.

## Technology Stack

- **Smart contracts**: Solidity 0.8.27, Hardhat, hardhat-deploy
- **FHE**: Zama FHEVM Solidity library and Zama relayer SDK
- **Frontend**: React + Vite
- **Wallet & RPC**: RainbowKit, wagmi, viem (reads), ethers (writes)
- **Cryptography**: WebCrypto (AES-GCM + SHA-256)
- **Network**: Sepolia

## System Architecture

**On-chain contract**
- `EncryptedDocumentVault` stores:
  - Document metadata (name, owner, timestamps)
  - Encrypted access key (`eaddress`)
  - Encrypted body (string ciphertext)
  - Shared access lists and ownership indexes

**Off-chain encryption flow**
- Access key A is generated in the UI as a random EVM address.
- A is encrypted with Zama and stored on-chain as an FHE handle.
- The user decrypts A via the Zama relayer (if allowed).
- The document body is encrypted locally with AES-GCM using a key derived from A.

**Frontend**
- Reads use viem for fast, stateless access.
- Writes use ethers to sign and send transactions.
- All sensitive operations are done in memory without localStorage.

## Data Model

`Document` fields in `EncryptedDocumentVault`:
- `owner`: address that created the document
- `name`: plaintext title (public)
- `encryptedBody`: base64 AES-GCM payload (public ciphertext)
- `accessKey`: FHE handle (encrypted key)
- `createdAt`: creation timestamp
- `updatedAt`: last update timestamp
- `lastEditorBlock`: block number of last edit

## Cryptography Details

- **Access key**: a random EVM address (A) generated in the browser.
- **FHE storage**: A is encrypted with Zama and stored as `eaddress`.
- **Body encryption**:
  - The access key is normalized to lowercase.
  - SHA-256 hash of the address derives a raw key.
  - AES-GCM encrypts the body with a random 12-byte IV.
  - Payload format: `base64(IV || ciphertext)`.

## Contract Interface Summary

- `createDocument(name, encryptedBody, encryptedAccessKey, inputProof)`
- `getDocument(documentId)`
- `updateDocumentBody(documentId, newEncryptedBody)`
- `grantAccess(documentId, grantee)`
- `getOwnedDocumentIds(owner)`
- `getSharedDocumentIds(user)`
- `documentExists(documentId)`
- `totalDocuments()`

## Project Structure

```
ObscureBase/
  contracts/                  # Solidity contracts
    EncryptedDocumentVault.sol
  deploy/                     # Deployment scripts
  tasks/                      # Hardhat tasks
  test/                       # Hardhat tests
  deployments/                # Deployment artifacts (local only)
  src/                        # Frontend workspace (Vite)
    src/                      # React source
  hardhat.config.ts
```

## Setup and Usage

### Prerequisites

- Node.js 20+
- npm
- A Sepolia wallet and RPC access

### Install (root workspace)

```bash
npm install
```

### Compile and test (local)

```bash
npm run compile
npm run test
```

### Deploy locally (for validation)

Start a local JSON-RPC node (Hardhat or Anvil) on `http://localhost:8545`, then:

```bash
npx hardhat deploy --network anvil
```

### Run local tasks

```bash
npx hardhat task:create-doc --network anvil --name "Draft" --body ""
npx hardhat task:decrypt-key --network anvil --id 1
npx hardhat task:grant-access --network anvil --id 1 --grantee 0x...
```

### Deploy to Sepolia

Create a `.env` file in the project root with:

```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=optional
```

Deploy:

```bash
npx hardhat deploy --network sepolia
```

### Update frontend contract bindings

After deployment, copy the ABI and address from `deployments/sepolia/EncryptedDocumentVault.json` into
`src/src/config/contracts.ts`. The frontend intentionally avoids importing JSON to keep configuration explicit.

### Run the frontend

```bash
cd src
npm install
npm run dev
```

Notes:
- The frontend is configured for Sepolia only.
- Wallet writes use `ethers`; reads use `viem`.
- No frontend environment variables are required.

## Design Notes and Constraints

- **No plaintext on-chain**: Only ciphertext is stored in the contract.
- **Public metadata**: Document names and timestamps are visible on-chain.
- **Access control**: Decryption rights are enforced by Zama FHE allowlists.
- **Key handling**: The decrypted key lives only in memory while the page is open.
- **Gas costs**: Encrypted bodies are stored on-chain, so large documents are expensive.

## Future Roadmap

- Multi-version document history with reversible checkpoints.
- Fine-grained permissions (read-only vs edit).
- Key rotation and revocation workflows.
- Batch sharing and address book management.
- Searchable encrypted metadata (name hashing or optional hidden names).
- Optional off-chain storage adapters (IPFS or Arweave) while keeping on-chain hashes.
- Rich content types (markdown, attachments, media).
- Gas optimizations for large bodies.
- Multi-chain deployment support and configurable networks.
- Formal security review and expanded test coverage.

## License

BSD-3-Clause-Clear. See `LICENSE`.
