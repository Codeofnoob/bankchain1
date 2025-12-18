# BankChain — Blockchain in Banking & Finance (full code + Windows guide)

This is a **complete, runnable, end-to-end** reference project that demonstrates how blockchain can be used in banking & finance workflows with real code and a clean architecture.

It’s designed to be:
- **Windows-first** (PowerShell commands, MetaMask-friendly)
- **Comprehensive but understandable**
- **Modular** (smart contracts + backend + frontend + indexer)

## What you get

### 1) Smart contracts (Solidity + Hardhat)
- **KYCRegistry**: compliance allowlist (only verified customers can use products)
- **DepositToken (BKD)**: a *tokenized deposit* / regulated stable-value token (demo)
- **BankVault**: deposit/withdraw (mints/burns BKD), compliant transfers (KYC-gated)
- **LendingPool**: collateralized borrowing with interest accrual + LTV controls

### 2) Backend (Node.js + Express + Ethers v6)
- Admin KYC endpoints (`/admin/kyc/approve`, `/admin/kyc/revoke`)
- Read endpoints (`/kyc/:user`, `/balance/:user`)
- **SQLite event indexer** for an audit trail (`/tx/:user`)

### 3) Frontend (React + Vite + Tailwind)
- Connect MetaMask
- Show KYC status
- Deposit / withdraw
- KYC-gated transfers
- Lending (deposit collateral, borrow, repay)
- Audit table (pulled from backend indexer)

---

## Why this matters in real banking/finance

Banks aren’t “just payments”. They’re *regulated risk machines*:
- **Compliance** (KYC/AML/sanctions): Who is allowed to move value?
- **Ledger integrity**: Can you audit transactions and reconcile them?
- **Product logic**: Deposits, lending, limits, interest, risk parameters

Blockchain is interesting because it can make certain parts:
- **tamper-evident** (auditability),
- **programmable** (rules enforced in code),
- **shared** (between entities in a consortium).

This project shows those ideas in a practical, runnable way.

Example mapping:
- *KYCRegistry* ≈ bank onboarding + compliance allowlist
- *BankVault* ≈ deposit ledger + tokenized representation
- *LendingPool* ≈ collateral, LTV, interest accrual
- *Indexer + SQLite* ≈ audit reporting layer

---

## Quick start (Windows)

### 0) Install prerequisites
- Node.js LTS (18+ or 20+)
- Git
- MetaMask

### 1) Install dependencies
From repo root:
```powershell
npm install
```

### 2) Start local blockchain
Terminal #1:
```powershell
npm run chain
```

### 3) Create env files
```powershell
.\scripts\windows-setup.ps1
```

### 4) Set backend admin key
Open `backend/.env` and set:
- `ADMIN_PRIVATE_KEY` = Hardhat Account #0 private key (shown in Terminal #1)

### 5) Deploy + seed + migrate DB + index initial events
Terminal #2:
```powershell
npm run deploy:local
```

### 6) Run backend
Terminal #2:
```powershell
npm run backend
```

### 7) Run frontend
Terminal #3:
```powershell
npm run frontend
```
node -e "const fs=require('fs'); const {ethers}=require('ethers'); (async()=>{ const pk=process.env.USER_PRIVATE_KEY; if(!pk) throw new Error('Missing USER_PRIVATE_KEY'); const cfg=JSON.parse(fs.readFileSync('./contracts.json','utf8')); const kycAddr=cfg.contracts.KYCRegistry; const provider=new ethers.JsonRpcProvider(cfg.rpcUrl); const wallet=new ethers.Wallet(pk,provider); const abi=['function requestKYC(bytes32) external']; const kyc=new ethers.Contract(kycAddr,abi,wallet); const h='0x26184cfaab60ff9836e3db568a0598281666c5c8273879c09985496a60997ca7'; const tx=await kyc.requestKYC(h); console.log('tx sent:',tx.hash); await tx.wait(); console.log('✅ requestKYC done'); })().catch(e=>{console.error(e); process.exit(1);});"


node -e "fetch('http://localhost:4000/admin/kyc/approve-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:1,level:1,expiresAt:0})}).then(async r=>{console.log('HTTP',r.status); console.log(await r.text())}).catch(console.error)"

Open:
- Backend health: http://localhost:4000/health
- Frontend UI: http://localhost:5173

---
Check nhanh: indexer có thật sự chạy và thấy block mới không?

Trong terminal ở root dự án chạy:

npm --workspace backend run indexer:once


node -e "const Database=require('better-sqlite3'); const db=new Database('./data/bankchain.sqlite'); db.exec('DELETE FROM events;'); console.log('✅ cleared events');"

cd backend
node src/indexer/indexer.js

## Repo structure

```
bankchain/
  contracts/           # Solidity + Hardhat
  backend/             # Express API + SQLite + event indexer
  frontend/            # React UI
  docs/                # Detailed Windows guide
  scripts/             # Helper scripts
  contracts.json       # Generated after deploy (addresses)
```

---

## Security notes (read this before you get brave)

This is a teaching project. It is **NOT** production-hardened.

Real systems require:
- safer upgrade strategy (proxy pattern + governance)
- oracle and pricing design (if collateral isn’t stable)
- liquidations
- sanctions screening and monitoring
- key management (HSM, MPC, multisig)
- incident response + audit logs
- formal verification or extensive audits

---

## Next extensions (turn this into a “serious” portfolio piece)

1. Replace ETH deposits with a mock stablecoin (ERC20 “USDC”).
2. Add per-user daily limits and risk tiers.
3. Add multisig for compliance actions.
4. Add “bank ledger export” CSV for reconciliation.
5. Add simple sanctions list (denylist mapping).
6. Add liquidation logic for under-collateralized positions.

---

## License
MIT


## Extra module: Trade finance / invoice factoring (contracts only)

Inside `contracts/contracts/` you also get:
- `InvoiceNFT.sol` — tokenizes an invoice/receivable as an NFT (audit-proof ownership)
- `FactoringMarket.sol` — a BKD-based marketplace to sell invoices (KYC-gated)

Why it matters (example):
- A supplier has a 90-day invoice. Instead of waiting, they sell it at a discount to an investor.
- The blockchain ledger becomes the **audit layer**: who owned the receivable, when, and at what price.

These contracts compile with the rest of the project but are not wired into the UI by default.
