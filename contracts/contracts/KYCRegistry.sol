// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * KYC v2:
 * - User publish pending on-chain: requestKYC(kycHash)
 * - Admin approve dựa trên pending: approveFromRequest(user, level, expiresAt)
 * - Cách A: admin auto-approved ngay lúc deploy
 * - Rule: admin muốn duyệt người khác thì chính admin cũng phải KYC-approved
 */
contract KYCRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    struct KYCInfo {
        bool approved;
        uint8 level;
        uint64 expiresAt; // 0 = never
    }

    mapping(address => KYCInfo) private _kyc;
    mapping(address => bytes32) public pendingKycHash; // user -> kycHash (on-chain pending)

    event KYCRequested(address indexed user, bytes32 indexed kycHash);
    event KYCApproved(address indexed user, address indexed by, uint8 level, uint64 expiresAt);
    event KYCRevoked(address indexed user, address indexed by);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);

        // ✅ Cách A: bootstrap admin đã KYC-approved ngay từ đầu
        _kyc[admin] = KYCInfo({ approved: true, level: 1, expiresAt: 0 });
        emit KYCApproved(admin, admin, 1, 0);
    }

    modifier onlyComplianceApproved() {
        require(hasRole(COMPLIANCE_ROLE, msg.sender), "Not compliance");
        require(isKYCApproved(msg.sender), "Admin must be KYC-approved");
        _;
    }

    function isKYCApproved(address user) public view returns (bool) {
        KYCInfo memory k = _kyc[user];
        if (!k.approved) return false;
        if (k.expiresAt == 0) return true;
        return block.timestamp <= k.expiresAt;
    }

    // ✅ User tự publish pending lên chain
    function requestKYC(bytes32 kycHash) external {
        require(kycHash != bytes32(0), "kycHash=0");
        pendingKycHash[msg.sender] = kycHash;
        emit KYCRequested(msg.sender, kycHash);
    }

    // ✅ Admin duyệt dựa trên pending on-chain (deploy.ts của bạn đang gọi cái này)
    function approveFromRequest(address user, uint8 level, uint64 expiresAt) external onlyComplianceApproved {
        require(pendingKycHash[user] != bytes32(0), "No on-chain pending request");
        _kyc[user] = KYCInfo({ approved: true, level: level, expiresAt: expiresAt });
        pendingKycHash[user] = bytes32(0);
        emit KYCApproved(user, msg.sender, level, expiresAt);
    }

    // (Optional) alias để code cũ không chết (nhưng vẫn không bypass pending)
    function approveKYC(address user) external onlyComplianceApproved {
        require(pendingKycHash[user] != bytes32(0), "No on-chain pending request");
        _kyc[user] = KYCInfo({ approved: true, level: 1, expiresAt: 0 });
        pendingKycHash[user] = bytes32(0);
        emit KYCApproved(user, msg.sender, 1, 0);
    }

    function revokeKYC(address user) external onlyComplianceApproved {
        _kyc[user].approved = false;
        emit KYCRevoked(user, msg.sender);
    }
}
