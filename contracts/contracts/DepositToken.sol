// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {KYCRegistry} from "./KYCRegistry.sol";

/**
 * @title DepositToken (BKD)
 * @notice A simplified tokenized deposit / regulated stable-value token.
 *
 * Key point (banking reality):
 * - In regulated value systems, transfers must often be restricted to verified parties.
 * - This token enforces **KYC checks on every transfer** (unless a party is marked as a system address).
 *
 * Roles:
 * - DEFAULT_ADMIN_ROLE: parameter + system address management
 * - MINTER_ROLE: mint/burn (BankVault)
 */
contract DepositToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    KYCRegistry public immutable kyc;

    mapping(address => bool) public isSystemAddress;

    error NotKYCApproved(address user);

    constructor(address admin, KYCRegistry _kyc) ERC20("BankChain Deposit Token", "BKD") {
        kyc = _kyc;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setSystemAddress(address who, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isSystemAddress[who] = enabled;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    /**
     * @dev OpenZeppelin v5 uses _update as the transfer hook.
     * Enforce KYC checks on transfers/mints/burns, unless an address is a system address.
     */
    function _update(address from, address to, uint256 value) internal override {
        // Mint
        if (from == address(0)) {
            if (!isSystemAddress[to] && !kyc.isKYCApproved(to)) revert NotKYCApproved(to);
            super._update(from, to, value);
            return;
        }

        // Burn
        if (to == address(0)) {
            if (!isSystemAddress[from] && !kyc.isKYCApproved(from)) revert NotKYCApproved(from);
            super._update(from, to, value);
            return;
        }

        // Transfer
        if (!isSystemAddress[from] && !kyc.isKYCApproved(from)) revert NotKYCApproved(from);
        if (!isSystemAddress[to] && !kyc.isKYCApproved(to)) revert NotKYCApproved(to);

        super._update(from, to, value);
    }
}
