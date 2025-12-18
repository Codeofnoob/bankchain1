import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { ethers } from "ethers";

import { initDb } from "./db/db.js";
import { getContracts, getContractsMeta, getAdminSigner, getAbi } from "./web3/web3.js";


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // đủ cho payload KYC demo (không upload ảnh raw)

const db = initDb();
const PORT = process.env.PORT || 4000;

// -------------------------
// Helpers (stable stringify + message/signature verification)
// -------------------------

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Stable stringify: cùng dữ liệu => cùng chuỗi => cùng hash.
 * Quan trọng vì nếu key order thay đổi thì hash sẽ đổi, admin duyệt sẽ loạn.
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * Message user ký để chứng minh sở hữu ví.
 * (Đây là “tôi là tôi” ở mức crypto: ai giữ private key thì ký được.)
 */
function buildKycMessage(canonicalPayload) {
  return `BankChain KYC Request
${canonicalPayload}`;
}

function isAddress(a) {
  try {
    return ethers.isAddress(a);
  } catch {
    return false;
  }
}

/**
 * Kiểm tra contract có hàm X hay không (để tương thích cả bản cũ và bản upgrade).
 */
function hasFn(contract, fnName) {
  return typeof contract?.[fnName] === "function";
}

// -------------------------
// Health + Meta
// -------------------------

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "bankchain-backend", ts: nowSec() })
);

app.get("/contracts", async (_req, res) => {
  const meta = await getContractsMeta();
  res.json(meta);
});
app.get("/abi/:name", (req, res) => {
  try {
    const abi = getAbi(req.params.name);
    res.json(abi);
  } catch (e) {
    res.status(404).json({ message: e.message });
  }
});

// -------------------------
// Read endpoints (balances, KYC status)
// -------------------------

app.get("/kyc/:user", async (req, res) => {

  const user = req.params.user;
  if (!isAddress(user)) return res.status(400).json({ message: "Bad address" });

  const { kyc } = await getContracts();

  // luôn giữ API này vì frontend đang gọi
  const approved = await kyc.isKYCApproved(user);

  // thêm dữ liệu DB (nếu có) để bạn nhìn “hồ sơ” off-chain
  const row = db
    .prepare(
      `SELECT id, wallet, kycHash, status, createdAt, reviewedAt, reviewer
       FROM kyc_requests
       WHERE wallet = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(user.toLowerCase());

  res.json({ user, approved, latestRequest: row || null });
});

app.get("/balance/:user", async (req, res) => {
  const user = req.params.user;
  if (!isAddress(user)) return res.status(400).json({ message: "Bad address" });

  const { token } = await getContracts();
  const bal = await token.balanceOf(user);
  res.json({ user, bkd: bal.toString() });
});

// -------------------------
// Audit Trail (events from indexer)
// -------------------------

app.get("/tx/:user", (req, res) => {
  const user = (req.params.user || "").toLowerCase();
  if (!isAddress(user)) return res.status(400).json({ message: "Bad address" });

  const rows = db
    .prepare(
      `
    SELECT id, blockNumber, txHash, eventName, fromAddr, toAddr, amount, timestamp
    FROM events
    WHERE fromAddr = ? OR toAddr = ?
    ORDER BY blockNumber DESC, id DESC
    LIMIT 200
  `
    )
    .all(user, user);

  res.json({ user, events: rows });
});

// -------------------------
// KYC v2 (OFF-CHAIN dossier + signature)  ✅
// -------------------------

/**
 * User submits KYC dossier to backend:
 * - backend verify signature to prove wallet ownership
 * - backend computes kycHash (fingerprint of canonical payload)
 * - store request in SQLite (PENDING)
 *
 * Note: docRef/docHash chỉ nên là reference (hash/CID/path), không lưu raw image ở đây.
 */
const kycRequestSchema = z.object({
  wallet: z.string().min(1),
  fullName: z.string().min(2),
  dob: z.string().min(4), // demo: "2004-01-10"
  nationalId: z.string().min(6), // demo only
  addressText: z.string().min(5),

  // reference của ảnh/giấy tờ: hash/CID/URL nội bộ
  docRef: z.string().optional(),

  // chống replay
  nonce: z.number().int().nonnegative(),

  signature: z.string().min(20),
});

app.post("/kyc/request", (req, res) => {
  try {
    const body = kycRequestSchema.parse(req.body);

    if (!isAddress(body.wallet)) {
      return res.status(400).json({ message: "Bad wallet address" });
    }

    const wallet = body.wallet.toLowerCase();

    // payload dùng để hash (không chứa signature)
    const payload = {
      wallet,
      fullName: body.fullName,
      dob: body.dob,
      nationalId: body.nationalId,
      addressText: body.addressText,
      docRef: body.docRef || "",
      nonce: body.nonce,
    };

    const canonical = stableStringify(payload);
    const message = buildKycMessage(canonical);

    // Verify signature (proof-of-ownership)
    const recovered = ethers.verifyMessage(message, body.signature).toLowerCase();
    if (recovered !== wallet) {
      return res.status(400).json({
        message: "Invalid signature: wallet ownership proof failed",
      });
    }

    // Hash commitment (đây là thứ bạn publish lên chain)
    const kycHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));

    // chống spam/replay cơ bản: không cho trùng nonce cho cùng wallet
    const existed = db
      .prepare(
        `SELECT id FROM kyc_requests WHERE wallet = ? AND payloadJson LIKE ? LIMIT 1`
      )
      .get(wallet, `%\"nonce\":${body.nonce}%`);

    if (existed) {
      return res.status(400).json({ message: "Nonce already used for this wallet" });
    }

    const ts = nowSec();

    const ins = db
      .prepare(
        `
      INSERT INTO kyc_requests (
        wallet, kycHash, payloadJson, message, signature, docRef,
        status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `
      )
      .run(wallet, kycHash, canonical, message, body.signature, payload.docRef, ts, ts);

    // audit compliance action log
    db.prepare(
      `
      INSERT INTO kyc_actions(requestId, wallet, action, actor, at, detailsJson)
      VALUES (?, ?, 'SUBMITTED', ?, ?, ?)
    `
    ).run(ins.lastInsertRowid, wallet, "system", ts, JSON.stringify({ kycHash }));

    res.json({
      ok: true,
      requestId: ins.lastInsertRowid,
      wallet,
      kycHash,
      messageToSign: message, // hữu ích cho debug
    });
  } catch (e) {
    res.status(400).json({ message: e?.message || "Bad request" });
  }
});

// -------------------------
// Admin KYC Console v2 (view requests + approve by requestId) ✅
// -------------------------

app.get("/admin/kyc/requests", (_req, res) => {
  const rows = db
    .prepare(
      `
    SELECT id, wallet, kycHash, status, createdAt
    FROM kyc_requests
    WHERE status = 'PENDING'
    ORDER BY createdAt DESC
    LIMIT 200
  `
    )
    .all();
  res.json({ requests: rows });
});

app.get("/admin/kyc/requests/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Bad request id" });
  }

  const row = db
    .prepare(
      `
    SELECT id, wallet, kycHash, payloadJson, status, createdAt, reviewedAt, reviewer, notes, approveTxHash, revokeTxHash
    FROM kyc_requests
    WHERE id = ?
  `
    )
    .get(id);

  if (!row) return res.status(404).json({ message: "Not found" });
  res.json({ request: row });
});

const approveReqSchema = z.object({
  requestId: z.number().int().positive(),
  level: z.number().int().min(1).max(5).default(1),
  expiresAt: z.number().int().nonnegative().default(0), // unix seconds; 0=never
  notes: z.string().optional(),
});

app.post("/admin/kyc/approve-request", async (req, res) => {
  try {
    const { requestId, level, expiresAt, notes } = approveReqSchema.parse(req.body);

    const row = db.prepare(`SELECT * FROM kyc_requests WHERE id = ?`).get(requestId);
    if (!row) return res.status(404).json({ message: "Request not found" });
    if (row.status !== "PENDING") {
      return res.status(400).json({ message: "Request is not pending" });
    }

    const { kyc } = await getContracts();
    const admin = await getAdminSigner();

    // Nếu contract đã upgrade theo v2:
    // - user phải publish requestHash on-chain: kyc.requestKYC(kycHash)
    // - admin approveFromRequest(user, level, expiresAt)
    let receiptHash = null;

    if (hasFn(kyc, "approveFromRequest") && hasFn(kyc, "pendingRequest")) {
      const pending = await kyc.pendingRequest(row.wallet);
      if (!pending || pending === ethers.ZeroHash) {
        return res.status(400).json({
          message:
            "On-chain pending request not found. User must call requestKYC(kycHash) on-chain first.",
        });
      }

      // optional: check match hash
      if (pending.toLowerCase() !== String(row.kycHash).toLowerCase()) {
        return res.status(400).json({
          message:
            "On-chain pending hash does not match DB kycHash. Refuse to approve.",
        });
      }

      const tx = await kyc.connect(admin).approveFromRequest(row.wallet, level, expiresAt);
      const receipt = await tx.wait();
      receiptHash = receipt.hash;
    } else if (hasFn(kyc, "approveKYC")) {
      // fallback: contract cũ (approve thẳng address)
      const tx = await kyc.connect(admin).approveKYC(row.wallet);
      const receipt = await tx.wait();
      receiptHash = receipt.hash;
    } else {
      return res.status(500).json({ message: "KYC contract does not support approval methods" });
    }

    const ts = nowSec();
    db.prepare(
      `
      UPDATE kyc_requests
      SET status='APPROVED', reviewedAt=?, updatedAt=?, reviewer=?, notes=?, approveTxHash=?
      WHERE id=?
    `
    ).run(ts, ts, (await admin.getAddress()).toLowerCase(), notes || null, receiptHash, requestId);

    db.prepare(
      `
      INSERT INTO kyc_actions(requestId, wallet, action, actor, txHash, at, detailsJson)
      VALUES (?, ?, 'APPROVED', ?, ?, ?, ?)
    `
    ).run(
      requestId,
      row.wallet,
      (await admin.getAddress()).toLowerCase(),
      receiptHash,
      ts,
      JSON.stringify({ level, expiresAt })
    );

    res.json({ ok: true, txHash: receiptHash });
  } catch (e) {
    res.status(400).json({ message: e?.message || "Bad request" });
  }
});

const rejectReqSchema = z.object({
  requestId: z.number().int().positive(),
  notes: z.string().optional(),
});

app.post("/admin/kyc/reject-request", async (req, res) => {
  try {
    const { requestId, notes } = rejectReqSchema.parse(req.body);
    const row = db.prepare(`SELECT * FROM kyc_requests WHERE id = ?`).get(requestId);
    if (!row) return res.status(404).json({ message: "Request not found" });
    if (row.status !== "PENDING") return res.status(400).json({ message: "Not pending" });

    const admin = await getAdminSigner();
    const ts = nowSec();

    db.prepare(
      `
      UPDATE kyc_requests
      SET status='REJECTED', reviewedAt=?, updatedAt=?, reviewer=?, notes=?
      WHERE id=?
    `
    ).run(ts, ts, (await admin.getAddress()).toLowerCase(), notes || null, requestId);

    db.prepare(
      `
      INSERT INTO kyc_actions(requestId, wallet, action, actor, at, detailsJson)
      VALUES (?, ?, 'REJECTED', ?, ?, ?)
    `
    ).run(
      requestId,
      row.wallet,
      (await admin.getAddress()).toLowerCase(),
      ts,
      JSON.stringify({ notes: notes || "" })
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e?.message || "Bad request" });
  }
});

// -------------------------
// Backwards-compatible Admin endpoints (frontend cũ vẫn gọi được)
// - /admin/kyc/approve { user } sẽ cố tìm request pending gần nhất của user và approve.
// - /admin/kyc/revoke  { user } revoke on-chain và update DB nếu có.
// -------------------------

const kycSchema = z.object({
  user: z.string().min(1),
  level: z.number().int().min(1).max(5).optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

app.post("/admin/kyc/approve", async (req, res) => {
  try {
    const { user, level = 1, expiresAt = 0, notes } = kycSchema.parse(req.body);
    if (!isAddress(user)) return res.status(400).json({ message: "Bad address" });

    const wallet = user.toLowerCase();

    // tìm request pending gần nhất
    const row = db
      .prepare(
        `SELECT * FROM kyc_requests WHERE wallet = ? AND status='PENDING' ORDER BY id DESC LIMIT 1`
      )
      .get(wallet);

    if (!row) {
      return res.status(400).json({
        message:
          "No pending KYC request in DB. User must submit /kyc/request first.",
      });
    }

    // gọi approve-request để tái sử dụng logic
    req.body = { requestId: row.id, level, expiresAt, notes };
    return app._router.handle(req, res, () => {});
  } catch (e) {
    res.status(400).json({ message: e?.message || "Bad request" });
  }
});

app.post("/admin/kyc/revoke", async (req, res) => {
  try {
    const { user, notes } = kycSchema.parse(req.body);
    if (!isAddress(user)) return res.status(400).json({ message: "Bad address" });

    const wallet = user.toLowerCase();
    const { kyc } = await getContracts();
    const admin = await getAdminSigner();

    let receiptHash = null;

    if (hasFn(kyc, "revokeKYC")) {
      const tx = await kyc.connect(admin).revokeKYC(wallet);
      const receipt = await tx.wait();
      receiptHash = receipt.hash;
    } else {
      return res.status(500).json({ message: "KYC contract does not support revokeKYC" });
    }

    const ts = nowSec();

    // update latest approved request if exists
    const latest = db
      .prepare(
        `SELECT id FROM kyc_requests WHERE wallet=? AND status='APPROVED' ORDER BY id DESC LIMIT 1`
      )
      .get(wallet);

    if (latest) {
      db.prepare(
        `
        UPDATE kyc_requests
        SET updatedAt=?, reviewer=?, notes=?, revokeTxHash=?
        WHERE id=?
      `
      ).run(ts, ts, (await admin.getAddress()).toLowerCase(), notes || null, receiptHash, latest.id);
    }

    db.prepare(
      `
      INSERT INTO kyc_actions(requestId, wallet, action, actor, txHash, at, detailsJson)
      VALUES (?, ?, 'REVOKED', ?, ?, ?, ?)
    `
    ).run(
      latest?.id ?? null,
      wallet,
      (await admin.getAddress()).toLowerCase(),
      receiptHash,
      ts,
      JSON.stringify({ notes: notes || "" })
    );

    res.json({ ok: true, txHash: receiptHash });
  } catch (e) {
    res.status(400).json({ message: e?.message || "Bad request" });
  }
});

// -------------------------
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
