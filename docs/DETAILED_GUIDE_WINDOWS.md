# BankChain — Detailed Windows Guide (step-by-step)

This guide assumes **Windows 10/11**, PowerShell, and MetaMask.

---

## A. Install prerequisites

### A1) Node.js
- Install Node.js **LTS** (18+ or 20+).
- Verify:
```powershell
node -v
npm -v
```

### A2) Git
- Install Git for Windows.
- Verify:
```powershell
git --version
```

### A3) MetaMask
- Install MetaMask extension in Chrome/Edge.

---

## B. Get the code

If you have the repo as a folder already, skip.

```powershell
git clone <your-repo-url> bankchain
cd bankchain
```

---

## C. Install dependencies

```powershell
npm install
```

Because we use **npm workspaces**, this installs dependencies for:
- `contracts/`
- `backend/`
- `frontend/`

---

## D. Start the local blockchain

Terminal #1:
```powershell
npm run chain
```

You will see a list of accounts like:

- Account #0 (admin/compliance)
- Account #1 (Alice)
- Account #2 (Bob)

Each has a private key. Keep Terminal #1 running.

---

## E. Configure backend admin key

1. Copy env templates:

```powershell
.\scripts\windows-setup.ps1
```

2. Open `backend/.env` and set:

- `ADMIN_PRIVATE_KEY` = private key for **Hardhat Account #0**

> Why: the backend signs compliance transactions (approve/revoke KYC).

---

## F. Deploy contracts + seed demo actions

Terminal #2:
```powershell
npm run deploy:local
```

This:
- deploys contracts to `localhost` network
- writes `contracts.json` in repo root
- migrates SQLite schema
- indexes initial events once

---

## G. Run backend API

Terminal #2 (same terminal is fine after deploy):
```powershell
npm run backend
```

Check:
- http://localhost:4000/health

---

## H. Run frontend UI

Terminal #3:
```powershell
npm run frontend
```

Visit:
- http://localhost:5173

---

## I. Configure MetaMask to connect

1. In MetaMask → Networks → Add network (manual):
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`

2. Import one test account:
   - Use private key from Hardhat output.

3. Connect wallet in the UI.

---

## J. Try the core banking/finance flows

### 1) KYC gating
- The UI shows if your address is approved.
- If not approved, use Admin Console:
  - Enter your address
  - Approve
- This demonstrates compliance controls.

### 2) Deposit / Withdraw
- Deposit ETH → get BKD (tokenized deposit).
- Withdraw burns BKD → returns ETH.

### 3) Compliant transfer
- Send BKD to another KYC-approved address.

### 4) Lending
- Deposit BKD collateral
- Borrow BKD up to LTV limit
- Repay; interest accrues over time

### 5) Audit trail
- Scroll down to see event history from SQLite indexer.

---

## K. Practical extension ideas (make it more "bank-like")

1. Replace ETH deposit with an **ERC20 stablecoin** (mock USDC).
2. Add **transaction limits** (per day / per customer).
3. Add **sanctions list** checks (off-chain oracle or admin set).
4. Add **multi-sig** for compliance actions.
5. Add **proof-of-reserve** or reconciliation exports.
6. Add **credit scoring** + risk tiers affecting APR and LTV.

---

## L. Typical errors

- MetaMask shows wrong network: switch to chainId 31337.
- Backend says ABI not found: run `npm run compile`.
- Admin endpoints fail: set correct `ADMIN_PRIVATE_KEY`.

---
