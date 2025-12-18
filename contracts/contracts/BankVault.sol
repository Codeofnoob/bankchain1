// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DepositToken} from "./DepositToken.sol";
import {KYCRegistry} from "./KYCRegistry.sol";

/**
 * @title BankVault
 * @notice Demo vault that mints/burns BKD against ETH deposits.
 *         This approximates "tokenized deposits" / internal e-money.
 *
 * IMPORTANT: Using ETH as the deposit asset is a demo simplification.
 * In production you'd use fiat rails + accounting reconciliation,
 * or tokenized cash on a permissioned chain, etc.
 */
contract BankVault is AccessControl, ReentrancyGuard {
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    DepositToken public immutable token;
    KYCRegistry public immutable kyc;

    event Deposited(address indexed user, uint256 ethAmount, uint256 mintedBKD);
    event Withdrawn(address indexed user, uint256 burnedBKD, uint256 ethReturned);
    event TransferBKD(address indexed from, address indexed to, uint256 amount);

    error NotKYCApproved(address user);

    constructor(address admin, DepositToken _token, KYCRegistry _kyc) {
        token = _token;
        kyc = _kyc;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
    }

    modifier onlyKYC(address user) {
        if (!kyc.isKYCApproved(user)) revert NotKYCApproved(user);
        _;
    }

    /**
     * @notice Deposit ETH and mint BKD 1:1 with wei (demo).
     */
    function deposit() external payable nonReentrant onlyKYC(msg.sender) {
        require(msg.value > 0, "Deposit must be > 0");
        token.mint(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value, msg.value);
    }

    /**
     * @notice Burn BKD and withdraw ETH 1:1 with wei (demo).
     */
    function withdraw(uint256 amount) external nonReentrant onlyKYC(msg.sender) {
        require(amount > 0, "Amount must be > 0");
        token.burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit Withdrawn(msg.sender, amount, amount);
    }

    /**
     * @notice KYC-gated BKD transfer. (You could also enforce this in the token itself,
     *         but doing it here keeps the token ERC20-simple while still demonstrating compliance.)
     */
    function transferBKD(address to, uint256 amount)
        external
        nonReentrant
        onlyKYC(msg.sender)
        onlyKYC(to)
    {
        require(amount > 0, "Amount must be > 0");
        // pull tokens then push to recipient
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        require(token.transfer(to, amount), "transfer failed");
        emit TransferBKD(msg.sender, to, amount);
    }

    /**
     * @notice Treasury can withdraw stray ETH (fees, donations, etc.) — demo admin control.
     */
    function treasuryWithdrawETH(address to, uint256 amount) external onlyRole(TREASURY_ROLE) {
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    receive() external payable {}
}
