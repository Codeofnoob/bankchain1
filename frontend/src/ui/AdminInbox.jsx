import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

// Admin mặc định của Hardhat local (account #0)
const DEFAULT_ADMIN = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function Section({ title, children }) {
  return (
    <div className="card p-5">
      <div className="text-lg font-bold mb-3">{title}</div>
      {children}
    </div>
  );
}

function prettyJson(s) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function short(x, n = 16) {
  if (!x) return "";
  const s = String(x);
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export default function AdminInbox({ backendUrl, currentWallet, onAfterAction }) {
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);

  const isAdmin = useMemo(() => {
    if (!currentWallet) return false;
    return currentWallet.toLowerCase() === DEFAULT_ADMIN;
  }, [currentWallet]);

  async function loadList() {
    setLoadingList(true);
    try {
      const { data } = await axios.get(`${backendUrl}/admin/kyc/requests`);
      setList(data.requests || []);
    } catch (e) {
      setMsg(`Load inbox failed: ${e?.response?.data?.message || e.message}`);
    } finally {
      setLoadingList(false);
    }
  }

  async function openRequest(id) {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetail(null);
    setMsg("");
    try {
      const { data } = await axios.get(`${backendUrl}/admin/kyc/requests/${id}`);
      setDetail(data.request);
    } catch (e) {
      setMsg(`Load request failed: ${e?.response?.data?.message || e.message}`);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function approve() {
    if (!selectedId) return;
    setActing(true);
    setMsg("");
    try {
      const { data } = await axios.post(`${backendUrl}/admin/kyc/approve-request`, {
        requestId: selectedId,
        level: 1,
        expiresAt: 0,
        notes: notes || undefined,
      });

      setMsg(`✅ Approved request #${selectedId}. tx=${data.txHash}`);
      setNotes("");
      await loadList();
      if (onAfterAction) await onAfterAction();
    } catch (e) {
      const m = e?.response?.data?.message || e.message;

      // case hay gặp nhất với KYC v2:
      // user chưa publish requestKYC(kycHash) lên chain
      if (String(m).includes("pending request not found")) {
        setMsg(
          `❌ Approve blocked: thiếu pending request trên chain.\n` +
          `➡️ Yêu cầu user bấm "Publish on-chain (requestKYC)" trước, rồi admin approve lại.\n` +
          `Chi tiết: ${m}`
        );
      } else {
        setMsg(`❌ Approve failed: ${m}`);
      }
    } finally {
      setActing(false);
    }
  }

  async function reject() {
    if (!selectedId) return;
    setActing(true);
    setMsg("");
    try {
      await axios.post(`${backendUrl}/admin/kyc/reject-request`, {
        requestId: selectedId,
        notes: notes || undefined,
      });

      setMsg(`✅ Rejected request #${selectedId}`);
      setNotes("");
      setSelectedId(null);
      setDetail(null);
      await loadList();
      if (onAfterAction) await onAfterAction();
    } catch (e) {
      setMsg(`❌ Reject failed: ${e?.response?.data?.message || e.message}`);
    } finally {
      setActing(false);
    }
  }

  // Auto refresh inbox (giống “admin nhận được hồ sơ mới”)
  useEffect(() => {
    if (!isAdmin) return;
    loadList().catch(() => {});
    const t = setInterval(() => loadList().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <Section title="Admin Inbox (Pending KYC Requests)">
        <div className="text-sm text-slate-400">
          Bạn đang connect ví <span className="font-mono">{currentWallet || "—"}</span>.
          <br />
          Admin inbox chỉ mở cho account #0 (Hardhat admin):{" "}
          <span className="font-mono">{DEFAULT_ADMIN}</span>.
          <br />
          👉 Hãy chuyển MetaMask sang account #0 để duyệt KYC cho người khác.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Admin Inbox (Pending KYC Requests)">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-slate-300">
          Logged in as Admin: <span className="font-mono">{short(currentWallet, 22)}</span>
        </div>
        <button className="btn2" onClick={loadList} disabled={loadingList}>
          {loadingList ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* LEFT: list */}
        <div>
          <div className="text-sm text-slate-300 mb-2">
            Pending list ({list.length})
          </div>

          <div className="space-y-2 max-h-72 overflow-auto">
            {list.map((r) => (
              <button
                key={r.id}
                className={
                  "w-full text-left p-3 rounded-xl border " +
                  (selectedId === r.id ? "border-slate-500" : "border-slate-800")
                }
                onClick={() => openRequest(r.id)}
              >
                <div className="text-sm font-semibold">
                  Request #{r.id} — {r.status}
                </div>
                <div className="text-xs text-slate-400 font-mono break-all">
                  {r.wallet}
                </div>
                <div className="text-xs text-slate-500 mt-1 font-mono">
                  kycHash: {short(r.kycHash, 22)}
                </div>
              </button>
            ))}

            {!list.length && (
              <div className="text-sm text-slate-400">
                Không có hồ sơ chờ duyệt. (User submit KYC thì sẽ hiện ở đây sau 1–3s)
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: detail */}
        <div>
          <div className="text-sm text-slate-300 mb-2">Details</div>

          {loadingDetail && (
            <div className="text-sm text-slate-400">Loading request...</div>
          )}

          {!loadingDetail && !detail && (
            <div className="text-sm text-slate-400">
              Chọn một hồ sơ bên trái để xem chi tiết và duyệt/từ chối.
            </div>
          )}

          {!loadingDetail && detail && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400">Wallet</div>
              <div className="font-mono text-xs break-all">{detail.wallet}</div>

              <div className="text-xs text-slate-400 mt-2">kycHash</div>
              <div className="font-mono text-xs break-all">{detail.kycHash}</div>

              <div className="text-xs text-slate-400 mt-2">Submitted payload</div>
              <pre className="text-xs bg-slate-900/60 border border-slate-800 rounded-xl p-3 max-h-48 overflow-auto">
{prettyJson(detail.payloadJson)}
              </pre>

              <div className="text-xs text-slate-400 mt-2">Admin notes</div>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="VD: verified ID photo / passed sanctions check / ... "
              />

              <div className="flex gap-2 mt-3">
                <button className="btn2" onClick={approve} disabled={acting}>
                  {acting ? "Processing..." : "Approve"}
                </button>
                <button className="btn2" onClick={reject} disabled={acting}>
                  {acting ? "Processing..." : "Reject"}
                </button>
              </div>

              <div className="text-xs text-slate-500 mt-3">
                Tip: Nếu Approve báo “pending request not found”, nghĩa là user chưa publish
                <span className="font-mono"> requestKYC(kycHash)</span> lên chain.
                Khi đó yêu cầu user bấm “Publish on-chain” trước.
              </div>
            </div>
          )}
        </div>
      </div>

      {msg && (
        <div className="text-sm mt-4 whitespace-pre-line text-slate-200">
          {msg}
        </div>
      )}
    </Section>
  );
}
