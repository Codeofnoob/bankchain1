// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DepositToken} from "./DepositToken.sol";
import {KYCRegistry} from "./KYCRegistry.sol";

/**
 * @title LendingPool
 * @notice Minimal lending product:
 * - Users deposit BKD as collateral
 * - Users can borrow BKD up to an LTV (loan-to-value) threshold
 * - Interest accrues linearly per second on outstanding debt
 *
 * This is deliberately simple, but maps to real lending concepts:
 * - collateral ratio / LTV
 * - interest rate model
 * - repayment flows
 */
contract LendingPool is AccessControl, ReentrancyGuard {
    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");

    DepositToken public immutable token;
    KYCRegistry public immutable kyc;

    // parameters (demo defaults)
    uint256 public maxLTVBps = 5000; // 50% (in basis points)
    uint256 public annualRateBps = 800; // 8% APR

    struct Account {
        uint256 collateral; // BKD deposited as collateral
        uint256 debt;       // BKD principal + accrued interest
        uint256 lastAccrued;
    }

    mapping(address => Account) public accounts;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount, uint256 newDebt);
    event Repaid(address indexed user, uint256 amount, uint256 remainingDebt);
    event ParamsUpdated(uint256 maxLTVBps, uint256 annualRateBps);

    error NotKYCApproved(address user);
    error InsufficientCollateral();
    error BorrowTooLarge();
    error DebtOutstanding();
    error AmountZero();

    constructor(address admin, DepositToken _token, KYCRegistry _kyc) {
        token = _token;
        kyc = _kyc;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ROLE, admin);
    }

    modifier onlyKYC(address user) {
        if (!kyc.isKYCApproved(user)) revert NotKYCApproved(user);
        _;
    }

    function setParams(uint256 _maxLTVBps, uint256 _annualRateBps) external onlyRole(RISK_ROLE) {
        require(_maxLTVBps <= 9000, "LTV too high");
        require(_annualRateBps <= 5000, "APR too high");
        maxLTVBps = _maxLTVBps;
        annualRateBps = _annualRateBps;
        emit ParamsUpdated(_maxLTVBps, _annualRateBps);
    }

    function _accrue(address user) internal {
        Account storage a = accounts[user];
        if (a.debt == 0) {
            a.lastAccrued = block.timestamp;
            return;
        }
        uint256 dt = block.timestamp - a.lastAccrued;
        if (dt == 0) return;

        // simple interest: debt += debt * rate * dt / year
        // rate in bps: annualRateBps / 10000
        uint256 interest = (a.debt * annualRateBps * dt) / (10000 * 365 days);
        a.debt += interest;
        a.lastAccrued = block.timestamp;
    }

    function depositCollateral(uint256 amount) external nonReentrant onlyKYC(msg.sender) {
        if (amount == 0) revert AmountZero();
        _accrue(msg.sender);

        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        accounts[msg.sender].collateral += amount;

        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant onlyKYC(msg.sender) {
        if (amount == 0) revert AmountZero();
        _accrue(msg.sender);

        Account storage a = accounts[msg.sender];
        require(a.collateral >= amount, "Not enough collateral");

        // after withdrawal, still must satisfy LTV: debt <= collateral * maxLTV
        uint256 newCollateral = a.collateral - amount;
        uint256 maxDebtAllowed = (newCollateral * maxLTVBps) / 10000;
        if (a.debt > maxDebtAllowed) revert InsufficientCollateral();

        a.collateral = newCollateral;
        require(token.transfer(msg.sender, amount), "transfer failed");

        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant onlyKYC(msg.sender) {
        if (amount == 0) revert AmountZero();
        _accrue(msg.sender);

        Account storage a = accounts[msg.sender];
        uint256 maxDebtAllowed = (a.collateral * maxLTVBps) / 10000;
        if (a.debt + amount > maxDebtAllowed) revert BorrowTooLarge();

        a.debt += amount;
        require(token.transfer(msg.sender, amount), "transfer failed");

        emit Borrowed(msg.sender, amount, a.debt);
    }

    function repay(uint256 amount) external nonReentrant onlyKYC(msg.sender) {
        if (amount == 0) revert AmountZero();
        _accrue(msg.sender);

        Account storage a = accounts[msg.sender];
        require(a.debt > 0, "No debt");

        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");

        if (amount >= a.debt) {
            uint256 over = amount - a.debt;
            a.debt = 0;
            a.lastAccrued = block.timestamp;

            // refund any overpayment
            if (over > 0) {
                require(token.transfer(msg.sender, over), "refund failed");
            }
            emit Repaid(msg.sender, amount - over, 0);
        } else {
            a.debt -= amount;
            emit Repaid(msg.sender, amount, a.debt);
        }
    }

    function getAccount(address user) external view returns (uint256 collateral, uint256 debt, uint256 lastAccrued) {
        Account memory a = accounts[user];

        // View function computes what debt would be if accrued up to now
        if (a.debt == 0) return (a.collateral, 0, a.lastAccrued);
        uint256 dt = block.timestamp - a.lastAccrued;
        uint256 interest = (a.debt * annualRateBps * dt) / (10000 * 365 days);
        return (a.collateral, a.debt + interest, a.lastAccrued);
    }
}
