import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ethers } from "ethers";

import { BACKEND_URL } from "../lib/config.js";
import { fmtWei } from "../lib/format.js";
import { requireMetaMask, fetchContracts, fetchAbi, loadContract } from "../lib/web3.js";
import AdminInbox from "./AdminInbox.jsx";

function Section({ title, children }) {
  return (
    <div className="card p-5">
      <div className="text-lg font-bold mb-3">{title}</div>
      {children}
    </div>
  );
}

// ---- KYC helpers (must match backend) ----
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function buildKycMessage(canonicalPayload) {
  return `BankChain KYC Request\n${canonicalPayload}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(hash));
}

function shortHex(x, n = 14) {
  if (!x) return "";
  const s = String(x);
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [contractsCfg, setContractsCfg] = useState(null);

  const [kycApproved, setKycApproved] = useState(null);
  const [kycLatest, setKycLatest] = useState(null);

  const [bkdBal, setBkdBal] = useState("0");
  const [events, setEvents] = useState([]);

  const [amountEth, setAmountEth] = useState("0.1");
  const [withdrawAmt, setWithdrawAmt] = useState("0.05");
  const [toAddr, setToAddr] = useState("");
  const [transferAmt, setTransferAmt] = useState("0.01");

  const [collateralAmt, setCollateralAmt] = useState("0.1");
  const [borrowAmt, setBorrowAmt] = useState("0.05");
  const [repayAmt, setRepayAmt] = useState("0.02");

  const [lending, setLending] = useState({ collateral: "0", debt: "0" });
  
  // --- NEW: KYC Application (user submits dossier + signature)
  const [kycForm, setKycForm] = useState({
    fullName: "",
    dob: "",
    nationalId: "",
    addressText: "",
    docRef: "", // hash/CID/reference (never store raw image on-chain)
  });
  const [kycDocName, setKycDocName] = useState("");
  const [kycSubmitMsg, setKycSubmitMsg] = useState("");
  const [kycSubmitting, setKycSubmitting] = useState(false);

  const [adminTarget, setAdminTarget] = useState("");
  const [adminMsg, setAdminMsg] = useState("");

  const connected = !!wallet?.address;

  useEffect(() => {
    (async () => {
      const cfg = await fetchContracts();
      setContractsCfg(cfg);
    })().catch(console.error);
  }, []);

  async function connect() {
    const w = await requireMetaMask();
    setWallet(w);
  }
  const [publishing, setPublishing] = useState(false);

async function publishKycOnChain() {
  setKycSubmitMsg(""); // bạn đang có setKycSubmitMsg rồi
  setPublishing(true);

  try {
    if (!wallet?.address) throw new Error("Chưa connect ví.");

    // 1) Lấy latest request từ backend để chắc chắn lấy đúng kycHash + status
    const { data } = await axios.get(`${BACKEND_URL}/kyc/${wallet.address}`);
    const latest = data?.latestRequest;

    const kycHash = latest?.kycHash || kycLatest?.kycHash; // fallback nếu bạn đã có state kycLatest
    const status = latest?.status || kycLatest?.status;

    if (!kycHash) {
      throw new Error("Chưa có kycHash. Hãy bấm 'Submit KYC (sign + send)' trước.");
    }

    if (status && status !== "PENDING") {
      throw new Error(`Hồ sơ không ở trạng thái PENDING (status=${status}). Không cần publish nữa.`);
    }

    // 2) Gọi requestKYC on-chain (MetaMask sẽ hiện transaction)
    const c = await contracts; // dự án bạn đang có biến contracts (promise/loader)
    if (!c?.kyc || typeof c.kyc.requestKYC !== "function") {
      throw new Error("Contract instance không có requestKYC. Kiểm tra ABI (/abi/KYCRegistry) và restart frontend.");
    }

    setKycSubmitMsg("⛓️ MetaMask sẽ hiện giao dịch. Hãy Confirm để publish KYC lên blockchain...");
    const tx = await c.kyc.requestKYC(kycHash);

    setKycSubmitMsg(`⛓️ Publishing... tx=${tx.hash}`);
    await tx.wait();

    setKycSubmitMsg(`✅ Publish on-chain xong. tx=${tx.hash}. Giờ admin có thể Approve.`);
    await refresh(); // update UI compliance
  } catch (e) {
    setKycSubmitMsg(`❌ Publish failed: ${e?.response?.data?.message || e.message}`);
  } finally {
    setPublishing(false);
  }
}

  const contracts = useMemo(() => {
    if (!wallet || !contractsCfg) return null;
    return (async () => {
      const [kycAbi, tokenAbi, vaultAbi, lendingAbi] = await Promise.all([
        fetchAbi("KYCRegistry"),
        fetchAbi("DepositToken"),
        fetchAbi("BankVault"),
        fetchAbi("LendingPool"),
      ]);
      const kyc = await loadContract(kycAbi, contractsCfg.contracts.KYCRegistry, wallet.signer);
      const token = await loadContract(tokenAbi, contractsCfg.contracts.DepositToken, wallet.signer);
      const vault = await loadContract(vaultAbi, contractsCfg.contracts.BankVault, wallet.signer);
      const lend = await loadContract(lendingAbi, contractsCfg.contracts.LendingPool, wallet.signer);
      return { kyc, token, vault, lend };
    })();
  }, [wallet, contractsCfg]);

  async function refresh() {
    if (!wallet || !contractsCfg) return;

    const { data: kycRes } = await axios.get(`${BACKEND_URL}/kyc/${wallet.address}`);
    setKycApproved(kycRes.approved);
    setKycLatest(kycRes.latestRequest || null);

    const { data: balRes } = await axios.get(`${BACKEND_URL}/balance/${wallet.address}`);
    setBkdBal(balRes.bkd);

    const { data: evRes } = await axios.get(`${BACKEND_URL}/tx/${wallet.address}`);
    setEvents(evRes.events);

    // lending view
    const c = await contracts;
    const acct = await c.lend.getAccount(wallet.address);
    setLending({ collateral: acct[0].toString(), debt: acct[1].toString() });
  }

  useEffect(() => {
    if (connected) {
      if (!adminTarget) setAdminTarget(wallet.address);
      refresh().catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function ensureApprovals() {
    const c = await contracts;
    // approve vault + lending for token transfers
    await (await c.token.approve(contractsCfg.contracts.BankVault, ethers.MaxUint256)).wait();
    await (await c.token.approve(contractsCfg.contracts.LendingPool, ethers.MaxUint256)).wait();
  }

  async function doDeposit() {
    const c = await contracts;
    await ensureApprovals();
    const tx = await c.vault.deposit({ value: ethers.parseEther(amountEth) });
    await tx.wait();
    await refresh();
  }

  async function doWithdraw() {
    const c = await contracts;
    const tx = await c.vault.withdraw(ethers.parseEther(withdrawAmt));
    await tx.wait();
    await refresh();
  }

  async function doTransfer() {
    const c = await contracts;
    const tx = await c.vault.transferBKD(toAddr, ethers.parseEther(transferAmt));
    await tx.wait();
    await refresh();
  }

  async function doDepositCollateral() {
    const c = await contracts;
    const tx = await c.lend.depositCollateral(ethers.parseEther(collateralAmt));
    await tx.wait();
    await refresh();
  }

  async function doBorrow() {
    const c = await contracts;
    const tx = await c.lend.borrow(ethers.parseEther(borrowAmt));
    await tx.wait();
    await refresh();
  }

  async function doRepay() {
    const c = await contracts;
    const tx = await c.lend.repay(ethers.parseEther(repayAmt));
    await tx.wait();
    await refresh();
  }

  // -------------------------
  // NEW: KYC flow (submit dossier + sign)
  // -------------------------
  async function onPickDoc(e) {
    setKycSubmitMsg("");
    const file = e.target.files?.[0];
    if (!file) return;

    setKycDocName(file.name);

    // Privacy-first: hash locally, store only hash/reference in DB.
    // (Real-world: upload to secure storage, store CID/path, hash for integrity.)
    try {
      const hex = await sha256File(file);
      setKycForm((v) => ({ ...v, docRef: `sha256:${hex}` }));
    } catch (err) {
      setKycSubmitMsg(`Doc hash error: ${err?.message || String(err)}`);
    }
  }

  async function submitKycRequest() {

    setKycSubmitMsg("");
    if (!connected) return;

    if (!kycForm.fullName || !kycForm.dob || !kycForm.nationalId || !kycForm.addressText) {
      setKycSubmitMsg("Please fill Full name / DOB / National ID / Address.");
      return;
    }

    setKycSubmitting(true);
    try {
      const nonce = Date.now();

      const payload = {
        wallet: wallet.address.toLowerCase(),
        fullName: kycForm.fullName.trim(),
        dob: kycForm.dob.trim(),
        nationalId: kycForm.nationalId.trim(),
        addressText: kycForm.addressText.trim(),
        docRef: kycForm.docRef || "",
        nonce,
      };

      const canonical = stableStringify(payload);
      const message = buildKycMessage(canonical);

      // 1) Prove wallet ownership
      const signature = await wallet.signer.signMessage(message);

      // 2) Send request to backend (creates DB row: PENDING)
      const { data } = await axios.post(`${BACKEND_URL}/kyc/request`, { ...payload, signature });

      // 3) OPTIONAL: publish request hash on-chain if your KYCRegistry supports requestKYC(bytes32).
      // If your ABI/contract doesn't have it, this is safely skipped.
      try {
        const c = await contracts;
        if (c?.kyc && typeof c.kyc.requestKYC === "function") {
          const tx = await c.kyc.requestKYC(data.kycHash);
          await tx.wait();
        }
      } catch (chainErr) {
        console.warn("requestKYC on-chain skipped/failed:", chainErr);
      }

      setKycSubmitMsg(`✅ Submitted. requestId=${data.requestId}, kycHash=${shortHex(data.kycHash)}`);
      await refresh();
    } catch (e) {
      setKycSubmitMsg(`Error: ${e?.response?.data?.message || e.message}`);
    } finally {
      setKycSubmitting(false);
    }
  }

  async function adminApprove() {
  setAdminMsg("");
  try {
    // Ưu tiên duyệt theo requestId mới nhất đang PENDING
    const reqId = (kycLatest && kycLatest.status === "PENDING") ? Number(kycLatest.id) : null;
    if (!reqId) {
      throw new Error("No pending KYC request to approve. Please submit KYC first.");
    }

    const { data } = await axios.post(
      `${BACKEND_URL}/admin/kyc/approve-request`,
      { requestId: reqId, level: 1, expiresAt: 0 },
      { headers: { "Content-Type": "application/json" } }
    );

    setAdminMsg(`Approved request #${reqId}. tx=${data.txHash}`);
    await refresh();
  } catch (e) {
    setAdminMsg(`Error: ${e?.response?.data?.message || e.message}`);
  }
}


  async function adminRevoke() {
    setAdminMsg("");
    try {
      const { data } = await axios.post(`${BACKEND_URL}/admin/kyc/revoke`, { user: adminTarget });
      setAdminMsg(`Revoked KYC. tx=${data.txHash}`);
      await refresh();
    } catch (e) {
      setAdminMsg(`Error: ${e?.response?.data?.message || e.message}`);
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-3xl font-black tracking-tight">BankChain Portal</div>
            <div className="text-slate-300 mt-1">
              A complete blockchain banking/finance demo: KYC → deposits → transfers → lending → audit trail.
            </div>
          </div>
          <div className="text-right">
            {!connected ? (
              <button className="btn" onClick={connect}>Connect MetaMask</button>
            ) : (
              <div className="space-y-1">
                <div className="text-sm text-slate-300">Connected</div>
                <div className="font-mono text-xs text-slate-200 break-all">{wallet.address}</div>
                <button className="btn2 mt-2" onClick={refresh}>Refresh</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Section title="Compliance (KYC)">
            <div className="flex items-center gap-2">
              <span className={"badge " + (kycApproved ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200")}>
                {kycApproved === null ? "Unknown" : kycApproved ? "KYC APPROVED" : "NOT APPROVED"}
              </span>
            </div>

            {kycLatest && (
              <div className="text-xs text-slate-300 mt-3 space-y-1">
                <div>
                  Latest request: <span className="font-mono">#{kycLatest.id}</span> —{" "}
                  <span className="font-semibold">{kycLatest.status}</span>
                </div>
                <div>
                  kycHash: <span className="font-mono">{shortHex(kycLatest.kycHash, 18)}</span>
                </div>
              </div>
            )}

            <div className="text-sm text-slate-300 mt-3">
              Why it matters: banks must block unverified or sanctioned participants. Here we gate deposits, transfers, and borrowing on-chain.
            </div>
          </Section>

          <Section title="Balances">
            <div className="text-sm text-slate-300">BKD (tokenized deposit)</div>
            <div className="text-2xl font-black">{fmtWei(bkdBal)} BKD</div>
            <div className="text-sm text-slate-400 mt-2">
              Example: depositing 1 ETH mints ~1 BKD (demo). In real systems it maps to fiat deposits and reconciles to the bank ledger.
            </div>
          </Section>

          <Section title="Lending Snapshot">
            <div className="text-sm text-slate-300">Collateral</div>
            <div className="text-xl font-bold">{fmtWei(lending.collateral)} BKD</div>
            <div className="text-sm text-slate-300 mt-2">Debt (incl. accrued interest)</div>
            <div className="text-xl font-bold">{fmtWei(lending.debt)} BKD</div>
          </Section>
        </div>

        {/* NEW: KYC Application */}
        <Section title="KYC Application (submit dossier + signature)">
          <div className="text-sm text-slate-300 mb-3">
            Submit personal info + (optional) document hash, then sign a message to prove wallet ownership. This creates a PENDING KYC request in the backend DB.
            Compliance/admin can approve it.
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-300 mb-1">Full name</div>
              <input className="input" value={kycForm.fullName} onChange={(e) => setKycForm((v) => ({ ...v, fullName: e.target.value }))} />
            </div>
            <div>
              <div className="text-sm text-slate-300 mb-1">Date of birth (YYYY-MM-DD)</div>
              <input className="input" value={kycForm.dob} onChange={(e) => setKycForm((v) => ({ ...v, dob: e.target.value }))} />
            </div>
            <div>
              <div className="text-sm text-slate-300 mb-1">National ID (demo)</div>
              <input className="input" value={kycForm.nationalId} onChange={(e) => setKycForm((v) => ({ ...v, nationalId: e.target.value }))} />
            </div>
            <div>
              <div className="text-sm text-slate-300 mb-1">Address</div>
              <input className="input" value={kycForm.addressText} onChange={(e) => setKycForm((v) => ({ ...v, addressText: e.target.value }))} />
            </div>
          </div>

          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-300 mb-1">Document image (optional)</div>
              <input className="input" type="file" accept="image/*" onChange={onPickDoc} />
              {kycDocName && <div className="text-xs text-slate-400 mt-2">Selected: <span className="font-mono">{kycDocName}</span></div>}
              <div className="text-xs text-slate-500 mt-2">
                We hash locally (SHA-256) and store only the hash reference (docRef). No raw image is sent.
              </div>
            </div>

            <div>
              <div className="text-sm text-slate-300 mb-1">docRef (hash/CID)</div>
              <input className="input font-mono" value={kycForm.docRef} onChange={(e) => setKycForm((v) => ({ ...v, docRef: e.target.value }))} placeholder="sha256:... or ipfs://CID" />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button className="btn" onClick={submitKycRequest} disabled={!connected || kycSubmitting}>
              {kycSubmitting ? "Submitting..." : "Submit KYC (sign + send)"}
            </button>
            <button className="btn2" onClick={publishKycOnChain} disabled={!connected || publishing}>
    {publishing ? "Publishing..." : "Publish on-chain (requestKYC)"}
  </button>
            <button className="btn2" onClick={() => { setKycForm({ fullName: "", dob: "", nationalId: "", addressText: "", docRef: "" }); setKycDocName(""); setKycSubmitMsg(""); }}>
              Clear
            </button>
          </div>

          {kycSubmitMsg && <div className="text-sm mt-3 text-slate-200">{kycSubmitMsg}</div>}
        </Section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Deposit / Withdraw">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-slate-300 mb-1">Deposit ETH → mint BKD</div>
                <input className="input" value={amountEth} onChange={(e) => setAmountEth(e.target.value)} />
                <button className="btn mt-2" onClick={doDeposit} disabled={!connected}>Deposit</button>
              </div>
              <div>
                <div className="text-sm text-slate-300 mb-1">Withdraw BKD → receive ETH</div>
                <input className="input" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} />
                <button className="btn mt-2" onClick={doWithdraw} disabled={!connected}>Withdraw</button>
              </div>
            </div>
          </Section>

          <Section title="Compliant Transfer (KYC-gated)">
            <div className="text-sm text-slate-300 mb-1">Recipient address</div>
            <input className="input font-mono" placeholder="0x..." value={toAddr} onChange={(e) => setToAddr(e.target.value)} />
            <div className="text-sm text-slate-300 mb-1 mt-3">Amount (BKD)</div>
            <input className="input" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} />
            <button className="btn mt-2" onClick={doTransfer} disabled={!connected}>Transfer</button>
            <div className="text-sm text-slate-400 mt-2">
              Why it matters: KYC gating prevents transferring value to unknown parties (compliance + risk controls).
            </div>
          </Section>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Lending (Collateral → Borrow → Repay)">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-slate-300 mb-1">Deposit collateral (BKD)</div>
                <input className="input" value={collateralAmt} onChange={(e) => setCollateralAmt(e.target.value)} />
                <button className="btn mt-2" onClick={doDepositCollateral} disabled={!connected}>Deposit Collateral</button>
              </div>
              <div>
                <div className="text-sm text-slate-300 mb-1">Borrow (BKD)</div>
                <input className="input" value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value)} />
                <button className="btn mt-2" onClick={doBorrow} disabled={!connected}>Borrow</button>
              </div>
              <div>
                <div className="text-sm text-slate-300 mb-1">Repay (BKD)</div>
                <input className="input" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} />
                <button className="btn mt-2" onClick={doRepay} disabled={!connected}>Repay</button>
              </div>
            </div>
            <div className="text-sm text-slate-400 mt-3">
              Example: with 0.5 BKD collateral and 50% max LTV, you can borrow up to 0.25 BKD. Interest accrues over time.
            </div>
          </Section>

          <AdminInbox
    backendUrl={BACKEND_URL}
    currentWallet={wallet?.address}
    onAfterAction={refresh}
  />
        </div>

        <Section title="Audit Trail (indexed from on-chain events)">
          <div className="text-sm text-slate-400 mb-3">
            Why it matters: auditors and risk teams need queryable history. We index events into SQLite for fast reporting.
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-300">
                <tr>
                  <th className="py-2 pr-4">Block</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">From</th>
                  <th className="py-2 pr-4">To</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Tx</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4">{e.blockNumber}</td>
                    <td className="py-2 pr-4">{e.eventName}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.fromAddr?.slice(0, 10)}…</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.toAddr ? e.toAddr.slice(0, 10) + "…" : "-"}</td>
                    <td className="py-2 pr-4">{e.amount ? fmtWei(e.amount) : "-"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.txHash?.slice(0, 10)}…</td>
                  </tr>
                ))}
                {!events.length && (
                  <tr><td className="py-3 text-slate-400" colSpan={6}>No events yet (try deposit/transfer/borrow).</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="text-xs text-slate-500">
          BankChain is a teaching project. Use it to learn architecture and patterns, not as a drop-in production system.
        </div>
      </div>
    </div>
  );
}
