// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title InvoiceNFT
 * @notice Minimal tokenization of invoices for trade finance / factoring workflows.
 *
 * Banking reality:
 * - Factoring and supply-chain finance often revolve around a simple question:
 *   "Who owns the receivable, and can we prove it?"
 *
 * An NFT is a clean demo representation of "title to an invoice/receivable".
 * Settlement still happens through real-world legal + payment rails; the chain is the audit layer.
 */
contract InvoiceNFT is ERC721, AccessControl {
    bytes32 public constant BANK_ROLE = keccak256("BANK_ROLE");

    struct Invoice {
        string metadataURI;   // IPFS hash / doc reference
        uint256 faceValue;    // receivable amount (in BKD units for demo)
        uint256 dueDate;      // unix timestamp
        address issuer;       // buyer / debtor
        address supplier;     // seller / creditor
    }

    uint256 public nextId = 1;
    mapping(uint256 => Invoice) public invoices;

    event InvoiceMinted(uint256 indexed invoiceId, address indexed supplier, address indexed issuer, uint256 faceValue, uint256 dueDate);

    constructor(address admin) ERC721("BankChain Invoice", "BKI") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BANK_ROLE, admin);
    }

    function mintInvoice(
        address supplier,
        address issuer,
        uint256 faceValue,
        uint256 dueDate,
        string calldata metadataURI
    ) external onlyRole(BANK_ROLE) returns (uint256) {
        uint256 id = nextId++;
        invoices[id] = Invoice({
            metadataURI: metadataURI,
            faceValue: faceValue,
            dueDate: dueDate,
            issuer: issuer,
            supplier: supplier
        });

        _mint(supplier, id);
        emit InvoiceMinted(id, supplier, issuer, faceValue, dueDate);
        return id;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent token");
        return invoices[tokenId].metadataURI;
    }

    function supportsInterface(bytes4 interfaceId)
    public
    view
    virtual
    override(ERC721, AccessControl)
    returns (bool)
{
    return super.supportsInterface(interfaceId);
}

}
