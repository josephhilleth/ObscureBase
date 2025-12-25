import { useEffect, useMemo, useState } from 'react';
import { Contract, Interface, Wallet, ethers, isAddress } from 'ethers';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';

import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { decryptBodyWithKey, encryptBodyWithKey, isBodyEncryptionAvailable } from '../utils/crypto';
import { Header } from './Header';
import '../styles/DocumentApp.css';

type DocumentRecord = {
  id: number;
  name: string;
  encryptedBody: string;
  accessKeyHandle: string;
  owner: string;
  createdAt: number;
  updatedAt: number;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const normalizeHandle = (value: string | bigint) => (typeof value === 'string' ? value : ethers.toBeHex(value, 32));
const shorten = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;
const formatDate = (timestamp: number) => (timestamp ? new Date(timestamp * 1000).toLocaleString() : '--');
const isValidContractAddress = (value: string) => isAddress(value) && value !== ZERO_ADDRESS;

export function DocumentApp() {
  const { address, isConnected } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signer = useEthersSigner();
  const publicClient = usePublicClient({ chainId: sepolia.id });

  const [contractAddress, setContractAddress] = useState(CONTRACT_ADDRESS);
  const [addressInput, setAddressInput] = useState(CONTRACT_ADDRESS);
  const [docName, setDocName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(Wallet.createRandom().address);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [documentKey, setDocumentKey] = useState('');
  const [decryptedBody, setDecryptedBody] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [granteeAddress, setGranteeAddress] = useState('');
  const [creating, setCreating] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [decryptingKey, setDecryptingKey] = useState(false);
  const [decryptingBody, setDecryptingBody] = useState(false);
  const [savingBody, setSavingBody] = useState(false);
  const [granting, setGranting] = useState(false);

  const hasContract = isValidContractAddress(contractAddress);

  const ownedIds = useReadContract({
    address: hasContract ? (contractAddress as `0x${string}`) : undefined,
    abi: CONTRACT_ABI,
    functionName: 'getOwnedDocumentIds',
    args: hasContract && address ? [address] : undefined,
    chainId: sepolia.id,
    query: { enabled: Boolean(address) && hasContract },
  });

  const sharedIds = useReadContract({
    address: hasContract ? (contractAddress as `0x${string}`) : undefined,
    abi: CONTRACT_ABI,
    functionName: 'getSharedDocumentIds',
    args: hasContract && address ? [address] : undefined,
    chainId: sepolia.id,
    query: { enabled: Boolean(address) && hasContract },
  });

  const docIds = useMemo(() => {
    const ids = new Set<number>();
    (ownedIds.data as readonly bigint[] | undefined)?.forEach((id) => ids.add(Number(id)));
    (sharedIds.data as readonly bigint[] | undefined)?.forEach((id) => ids.add(Number(id)));
    return Array.from(ids).sort((a, b) => a - b);
  }, [ownedIds.data, sharedIds.data]);

  useEffect(() => {
    let cancelled = false;
    if (!hasContract || !publicClient || docIds.length === 0) {
      setDocuments([]);
      setSelectedId(null);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      setDocsLoading(true);
      try {
        const records: DocumentRecord[] = [];
        for (const id of docIds) {
          const result = await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'getDocument',
            args: [BigInt(id)],
          });

          const tuple = result as unknown as [
            string,
            string,
            string | bigint,
            string,
            bigint,
            bigint,
            bigint
          ];

          records.push({
            id,
            name: tuple[0],
            encryptedBody: tuple[1],
            accessKeyHandle: normalizeHandle(tuple[2]),
            owner: tuple[3],
            createdAt: Number(tuple[4]),
            updatedAt: Number(tuple[5]),
          });
        }

        if (!cancelled) {
          setDocuments(records);
          if (records.length > 0 && selectedId === null) {
            setSelectedId(records[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to load documents', error);
      } finally {
        if (!cancelled) {
          setDocsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [docIds, publicClient, contractAddress, hasContract, selectedId]);

  useEffect(() => {
    setDocumentKey('');
    setDecryptedBody('');
    setBodyDraft('');
  }, [selectedId]);

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedId) || null,
    [documents, selectedId]
  );

  const applyContractAddress = () => {
    if (!isValidContractAddress(addressInput)) {
      alert('Please paste a valid Sepolia contract address');
      return;
    }
    setContractAddress(addressInput);
    setSelectedId(null);
    setDocuments([]);
    setDocumentKey('');
    setDecryptedBody('');
  };

  const createDocument = async () => {
    if (!instance || !address) {
      alert('Wallet connection and Zama instance are required');
      return;
    }
    if (!hasContract) {
      alert('Set the deployed contract address first');
      return;
    }

    setCreating(true);
    try {
      const signerInstance = await signer;
      if (!signerInstance) {
        throw new Error('No signer found');
      }

      const input = instance.createEncryptedInput(contractAddress, address);
      input.addAddress(generatedKey);
      const encryptedInput = await input.encrypt();

      const contract = new Contract(contractAddress, CONTRACT_ABI, signerInstance);
      const tx = await contract.createDocument(
        docName.trim() || 'Untitled document',
        '',
        encryptedInput.handles[0],
        encryptedInput.inputProof
      );
      const receipt = await tx.wait();

      const iface = new Interface(CONTRACT_ABI);
      let newId: number | null = null;
      receipt?.logs?.forEach((log: any) => {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'DocumentCreated') {
            newId = Number(parsed.args.documentId);
          }
        } catch {
          // ignore unrelated logs
        }
      });

      await ownedIds.refetch();
      await sharedIds.refetch();
      if (newId) {
        setSelectedId(newId);
      }
      setDocName('');
      setGeneratedKey(Wallet.createRandom().address);
    } catch (error) {
      console.error('Failed to create document', error);
      alert('Failed to create document. Check console for details.');
    } finally {
      setCreating(false);
    }
  };

  const decryptAccessKey = async () => {
    if (!instance || !address || !selectedDoc) {
      alert('Missing instance, account, or document');
      return;
    }
    if (!hasContract) {
      alert('Set the deployed contract address first');
      return;
    }

    setDecryptingKey(true);
    try {
      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

      const signerInstance = await signer;
      if (!signerInstance) {
        throw new Error('No signer available');
      }

      const signature = await signerInstance.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [{ handle: selectedDoc.accessKeyHandle, contractAddress }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays
      );

      const decryptedKey = result[selectedDoc.accessKeyHandle];
      setDocumentKey(decryptedKey);
    } catch (error) {
      console.error('Failed to decrypt access key', error);
      alert('Unable to decrypt the access key. Ensure ACL has been granted.');
    } finally {
      setDecryptingKey(false);
    }
  };

  const decryptBody = async () => {
    if (!documentKey || !selectedDoc) {
      alert('Decrypt the access key first');
      return;
    }
    if (!isBodyEncryptionAvailable()) {
      alert('WebCrypto is unavailable in this browser');
      return;
    }

    setDecryptingBody(true);
    try {
      const clear = await decryptBodyWithKey(selectedDoc.encryptedBody, documentKey);
      setDecryptedBody(clear);
      setBodyDraft(clear);
    } catch (error) {
      console.error('Failed to decrypt body', error);
      alert('Unable to decrypt the document body with this key');
    } finally {
      setDecryptingBody(false);
    }
  };

  const saveBody = async () => {
    if (!documentKey || !selectedDoc) {
      alert('Decrypt the access key first');
      return;
    }
    if (!isBodyEncryptionAvailable()) {
      alert('WebCrypto is unavailable in this browser');
      return;
    }
    if (!hasContract) {
      alert('Set the deployed contract address first');
      return;
    }

    setSavingBody(true);
    try {
      const signerInstance = await signer;
      if (!signerInstance) {
        throw new Error('No signer available');
      }

      const encryptedBody = await encryptBodyWithKey(bodyDraft, documentKey);
      const contract = new Contract(contractAddress, CONTRACT_ABI, signerInstance);
      const tx = await contract.updateDocumentBody(BigInt(selectedDoc.id), encryptedBody);
      await tx.wait();

      setDecryptedBody(bodyDraft);
      await ownedIds.refetch();
      await sharedIds.refetch();
    } catch (error) {
      console.error('Failed to save body', error);
      alert('Updating the encrypted body failed. Make sure you have permission.');
    } finally {
      setSavingBody(false);
    }
  };

  const grantAccess = async () => {
    if (!selectedDoc) {
      alert('Select a document first');
      return;
    }
    if (!isAddress(granteeAddress)) {
      alert('Enter a valid address to share with');
      return;
    }
    if (!hasContract) {
      alert('Set the deployed contract address first');
      return;
    }

    setGranting(true);
    try {
      const signerInstance = await signer;
      if (!signerInstance) {
        throw new Error('No signer available');
      }

      const contract = new Contract(contractAddress, CONTRACT_ABI, signerInstance);
      const tx = await contract.grantAccess(BigInt(selectedDoc.id), granteeAddress);
      await tx.wait();
      setGranteeAddress('');
    } catch (error) {
      console.error('Failed to grant access', error);
      alert('Granting access failed. Ensure your address is allowed for this document.');
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <div className="app-body">
        <Header />

        <div className="panel contract-panel">
          <div>
            <p className="eyebrow">Deployment</p>
            <h2 className="panel-title">Point to your Sepolia vault</h2>
            <p className="panel-subtitle">
              Use the address from your Sepolia deployment in <code>deployments/sepolia/EncryptedDocumentVault.json</code>.
            </p>
          </div>
          <div className="contract-inputs">
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              className="text-input"
              placeholder="0x..."
            />
            <button className="primary-button" onClick={applyContractAddress}>
              Apply address
            </button>
          </div>
          {!hasContract && (
            <p className="warning-text">
              Contract address is not set. Deploy to Sepolia and paste the address to start.
            </p>
          )}
        </div>

        <div className="layout-grid">
          <div className="column">
            <div className="panel">
              <p className="eyebrow">Create</p>
              <h3 className="panel-title">Mint a locked document</h3>
              <p className="panel-subtitle">
                A fresh EVM address becomes your access key. We encrypt it with Zama and store an empty body on-chain.
              </p>

              <div className="field-group">
                <label>Document name</label>
                <input
                  className="text-input"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="Design brief, notes, research..."
                />
              </div>

              <div className="field-group">
                <label>Access key (generated locally)</label>
                <div className="inline-field">
                  <div className="key-chip">{generatedKey}</div>
                  <button className="ghost-button" onClick={() => setGeneratedKey(Wallet.createRandom().address)}>
                    Regenerate
                  </button>
                </div>
              </div>

              <button
                className="primary-button"
                onClick={createDocument}
                disabled={!isConnected || !hasContract || creating || zamaLoading}
              >
                {creating ? 'Submitting...' : 'Create encrypted document'}
              </button>

              {zamaLoading && <p className="muted-text">Initializing Zama SDK...</p>}
              {zamaError && <p className="warning-text">{zamaError}</p>}
            </div>

            <div className="panel">
              <p className="eyebrow">Access</p>
              <h3 className="panel-title">Share the key</h3>
              <p className="panel-subtitle">
                Allow collaborators to decrypt the key handle stored on-chain. They can decrypt and edit the body after.
              </p>
              <div className="field-group">
                <label>Address to allow</label>
                <input
                  className="text-input"
                  value={granteeAddress}
                  onChange={(e) => setGranteeAddress(e.target.value)}
                  placeholder="0x collaborator"
                />
              </div>
              <button
                className="secondary-button"
                onClick={grantAccess}
                disabled={!selectedDoc || granting || !hasContract}
              >
                {granting ? 'Granting...' : 'Grant access'}
              </button>
            </div>
          </div>

          <div className="column wide">
            <div className="panel">
              <div className="list-header">
                <div>
                  <p className="eyebrow">Your documents</p>
                  <h3 className="panel-title">Owned & shared</h3>
                </div>
                <div className="pill">
                  {docIds.length} items
                </div>
              </div>
              {docsLoading ? (
                <p className="muted-text">Loading documents...</p>
              ) : documents.length === 0 ? (
                <p className="muted-text">No documents yet. Create one to begin.</p>
              ) : (
                <div className="document-list">
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      className={`document-card ${selectedId === doc.id ? 'active' : ''}`}
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <div className="doc-meta">
                        <span className="doc-name">{doc.name}</span>
                        <span className="doc-id">#{doc.id}</span>
                      </div>
                      <div className="doc-sub">
                        <span className="doc-owner">
                          Owner: {shorten(doc.owner)}
                        </span>
                        <span className="doc-time">Updated {formatDate(doc.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <p className="eyebrow">Workspace</p>
              <h3 className="panel-title">Decrypt, edit, and commit</h3>
              {selectedDoc ? (
                <>
                  <div className="doc-details">
                    <div>
                      <div className="label">Name</div>
                      <div className="value">{selectedDoc.name}</div>
                    </div>
                    <div>
                      <div className="label">Access key handle</div>
                      <div className="value monospace">{selectedDoc.accessKeyHandle}</div>
                    </div>
                    <div className="detail-grid">
                      <div>
                        <div className="label">Created</div>
                        <div className="value">{formatDate(selectedDoc.createdAt)}</div>
                      </div>
                      <div>
                        <div className="label">Updated</div>
                        <div className="value">{formatDate(selectedDoc.updatedAt)}</div>
                      </div>
                      <div>
                        <div className="label">Owner</div>
                        <div className="value monospace">{shorten(selectedDoc.owner)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="action-row">
                    <button
                      className="primary-button"
                      onClick={decryptAccessKey}
                      disabled={decryptingKey || !hasContract}
                    >
                      {decryptingKey ? 'Decrypting key...' : 'Decrypt access key'}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={decryptBody}
                      disabled={!documentKey || decryptingBody}
                    >
                      {decryptingBody ? 'Decrypting body...' : 'Decrypt body'}
                    </button>
                  </div>

                  <div className="field-group">
                    <label>Plaintext body (encrypted with access key before saving)</label>
                    <textarea
                      className="text-area"
                      value={bodyDraft}
                      onChange={(e) => setBodyDraft(e.target.value)}
                      placeholder="Write or edit your document..."
                    />
                  </div>

                  <div className="action-row">
                    <button
                      className="primary-button"
                      onClick={saveBody}
                      disabled={!documentKey || savingBody}
                    >
                      {savingBody ? 'Encrypting...' : 'Encrypt & save'}
                    </button>
                    {decryptedBody && (
                      <div className="pill success">Decrypted with key {shorten(documentKey)}</div>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted-text">Select a document to start working with it.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
