// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, eaddress, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title EncryptedDocumentVault
/// @notice Stores encrypted documents and manages encrypted access keys with Zama FHE
/// @dev Document bodies are expected to be encrypted off-chain with the decrypted access key
contract EncryptedDocumentVault is ZamaEthereumConfig {
    struct Document {
        address owner;
        string name;
        string encryptedBody;
        eaddress accessKey;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 lastEditorBlock;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Document) private _documents;
    mapping(address => uint256[]) private _ownedDocuments;
    mapping(address => uint256[]) private _sharedDocuments;
    mapping(uint256 => mapping(address => bool)) private _isSharedWith;

    event DocumentCreated(uint256 indexed documentId, address indexed owner, string name);
    event DocumentUpdated(uint256 indexed documentId, address indexed editor, string encryptedBody);
    event AccessGranted(uint256 indexed documentId, address indexed grantee);

    /// @notice Create a new document with an encrypted access key
    /// @param name Human readable name for the document
    /// @param encryptedBody Ciphertext of the body created off-chain with the decrypted key (can be empty)
    /// @param encryptedAccessKey Encrypted access key produced with the Zama relayer
    /// @param inputProof Proof produced alongside the encrypted access key
    /// @return documentId The identifier of the freshly created document
    function createDocument(
        string calldata name,
        string calldata encryptedBody,
        externalEaddress encryptedAccessKey,
        bytes calldata inputProof
    ) external returns (uint256 documentId) {
        require(bytes(name).length > 0, "Name required");

        eaddress validatedKey = FHE.fromExternal(encryptedAccessKey, inputProof);

        documentId = _nextId++;
        _documents[documentId] = Document({
            owner: msg.sender,
            name: name,
            encryptedBody: encryptedBody,
            accessKey: validatedKey,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            lastEditorBlock: block.number
        });
        _ownedDocuments[msg.sender].push(documentId);

        FHE.allowThis(validatedKey);
        FHE.allow(validatedKey, msg.sender);

        emit DocumentCreated(documentId, msg.sender, name);
    }

    /// @notice Update the encrypted body for a document
    /// @param documentId Target document identifier
    /// @param newEncryptedBody Fresh ciphertext produced with the decrypted access key
    function updateDocumentBody(uint256 documentId, string calldata newEncryptedBody) external {
        Document storage doc = _getDocument(documentId);
        _requireAccess(doc.accessKey);

        doc.encryptedBody = newEncryptedBody;
        doc.updatedAt = block.timestamp;
        doc.lastEditorBlock = block.number;

        emit DocumentUpdated(documentId, msg.sender, newEncryptedBody);
    }

    /// @notice Grant decryption permission for the access key to another address
    /// @param documentId Target document identifier
    /// @param grantee Address that should be able to decrypt and edit
    function grantAccess(uint256 documentId, address grantee) external {
        require(grantee != address(0), "Invalid grantee");
        Document storage doc = _getDocument(documentId);
        _requireAccess(doc.accessKey);

        if (!_isSharedWith[documentId][grantee]) {
            _isSharedWith[documentId][grantee] = true;
            _sharedDocuments[grantee].push(documentId);
        }

        FHE.allow(doc.accessKey, grantee);
        emit AccessGranted(documentId, grantee);
    }

    /// @notice Get detailed metadata for a document
    /// @param documentId Target document identifier
    /// @return name Document name
    /// @return encryptedBody Off-chain encrypted body
    /// @return accessKey Encrypted access key (eaddress handle)
    /// @return owner Address that created the document
    /// @return createdAt Timestamp when the document was created
    /// @return updatedAt Timestamp when the body was last updated
    /// @return lastEditorBlock Block number of the last edit
    function getDocument(uint256 documentId)
        external
        view
        returns (
            string memory name,
            string memory encryptedBody,
            eaddress accessKey,
            address owner,
            uint256 createdAt,
            uint256 updatedAt,
            uint256 lastEditorBlock
        )
    {
        Document storage doc = _getDocument(documentId);
        return (doc.name, doc.encryptedBody, doc.accessKey, doc.owner, doc.createdAt, doc.updatedAt, doc.lastEditorBlock);
    }

    /// @notice Get the list of document ids created by a specific address
    /// @param owner Owner address
    function getOwnedDocumentIds(address owner) external view returns (uint256[] memory) {
        return _ownedDocuments[owner];
    }

    /// @notice Get the list of document ids shared with a specific address
    /// @param user Account that received access
    function getSharedDocumentIds(address user) external view returns (uint256[] memory) {
        return _sharedDocuments[user];
    }

    /// @notice Return whether a document exists
    /// @param documentId Target document identifier
    function documentExists(uint256 documentId) external view returns (bool) {
        return _documents[documentId].owner != address(0);
    }

    /// @notice Number of documents created in the system
    function totalDocuments() external view returns (uint256) {
        return _nextId - 1;
    }

    function _requireAccess(eaddress accessKey) private view {
        require(FHE.isSenderAllowed(accessKey), "Sender not authorized for key");
    }

    function _getDocument(uint256 documentId) private view returns (Document storage) {
        Document storage doc = _documents[documentId];
        require(doc.owner != address(0), "Document not found");
        return doc;
    }
}
