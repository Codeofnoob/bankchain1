// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DepositToken} from "./DepositToken.sol";
import {KYCRegistry} from "./KYCRegistry.sol";
import {InvoiceNFT} from "./InvoiceNFT.sol";

/**
 * @title FactoringMarket
 * @notice A minimal marketplace where suppliers can sell invoice NFTs to investors for BKD.
 *
 * This demonstrates a common banking/finance pattern:
 * - **originating** an asset (invoice)
 * - **secondary sale** (factoring / discounting)
 * - **compliance gating** (KYC allowlist)
 */
contract FactoringMarket is AccessControl, ReentrancyGuard {
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");

    DepositToken public immutable token;
    KYCRegistry public immutable kyc;
    InvoiceNFT public immutable invoice;

    struct Listing {
        address seller;
        uint256 price; // in BKD
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed invoiceId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed invoiceId, address indexed seller);
    event Purchased(uint256 indexed invoiceId, address indexed buyer, uint256 price);

    error NotKYCApproved(address user);
    error NotOwner();
    error NotActive();
    error AmountZero();

    constructor(address admin, DepositToken _token, KYCRegistry _kyc, InvoiceNFT _invoice) {
        token = _token;
        kyc = _kyc;
        invoice = _invoice;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_ADMIN_ROLE, admin);
    }

    modifier onlyKYC(address user) {
        if (!kyc.isKYCApproved(user)) revert NotKYCApproved(user);
        _;
    }

    function list(uint256 invoiceId, uint256 price)
        external
        nonReentrant
        onlyKYC(msg.sender)
    {
        if (price == 0) revert AmountZero();
        if (invoice.ownerOf(invoiceId) != msg.sender) revert NotOwner();

        // Transfer NFT into escrow
        invoice.transferFrom(msg.sender, address(this), invoiceId);

        listings[invoiceId] = Listing({ seller: msg.sender, price: price, active: true });
        emit Listed(invoiceId, msg.sender, price);
    }

    function unlist(uint256 invoiceId) external nonReentrant {
        Listing memory l = listings[invoiceId];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotOwner();

        listings[invoiceId].active = false;
        invoice.transferFrom(address(this), msg.sender, invoiceId);
        emit Unlisted(invoiceId, msg.sender);
    }

    function buy(uint256 invoiceId)
        external
        nonReentrant
        onlyKYC(msg.sender)
    {
        Listing memory l = listings[invoiceId];
        if (!l.active) revert NotActive();

        // Pull BKD from buyer to seller
        require(token.transferFrom(msg.sender, l.seller, l.price), "BKD transfer failed");

        // Transfer NFT to buyer
        listings[invoiceId].active = false;
        invoice.transferFrom(address(this), msg.sender, invoiceId);

        emit Purchased(invoiceId, msg.sender, l.price);
    }
}
