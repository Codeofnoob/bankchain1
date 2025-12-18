import dotenv from "dotenv";
import { initDb } from "./db.js";

/**
 * SQLite schema migration for BankChain backend.
 *
 * Design goals:
 * - Idempotent: running multiple times is safe.
 * - Backwards compatible: adds columns/tables without breaking existing ones.
 * - Banking-friendly auditability: store events + KYC request lifecycle (off-chain),
 *   but NEVER put raw PII on-chain.
 */

dotenv.config();

const db = initDb();

// Extra safety/perf pragmas (WAL is set in initDb already).
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

function tableExists(name) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?"
    )
    .get(name);
  return !!row;
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(table, columnDef, columnName) {
  const name = columnName ?? columnDef.split(/\s+/)[0];
  if (!columnExists(table, name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

function setUserVersion(v) {
  db.pragma(`user_version = ${v}`);
}

function getUserVersion() {
  return db.pragma("user_version", { simple: true }) || 0;
}

// ---- Migration steps ------------------------------------------------------

function migrateToV1() {
  // Core audit table for on-chain events (indexed into SQLite).
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blockNumber INTEGER NOT NULL,
      txHash TEXT NOT NULL,
      eventName TEXT NOT NULL,
      fromAddr TEXT,
      toAddr TEXT,
      amount TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_events_from ON events(fromAddr);
CREATE INDEX IF NOT EXISTS idx_events_to ON events(toAddr);
CREATE INDEX IF NOT EXISTS idx_events_block ON events(blockNumber);
  `);
}

function migrateToV2() {
  // Add optional columns without breaking the current indexer.
  // These are useful when you later upgrade the indexer to store logIndex/contract.
  addColumnIfMissing("events", "logIndex INTEGER", "logIndex");
  addColumnIfMissing("events", "contractAddress TEXT", "contractAddress");
  addColumnIfMissing("events", "metaJson TEXT", "metaJson");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_from ON events(fromAddr);
    CREATE INDEX IF NOT EXISTS idx_events_to ON events(toAddr);
    CREATE INDEX IF NOT EXISTS idx_events_block ON events(blockNumber);
    CREATE INDEX IF NOT EXISTS idx_events_tx ON events(txHash);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(eventName);
  `);
}

function migrateToV3() {
  // Store indexer checkpoints explicitly (more robust than SELECT MAX(blockNumber)).
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lastIndexedBlock INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER
    );
    INSERT OR IGNORE INTO indexer_state (id, lastIndexedBlock, updatedAt)
    VALUES (1, 0, strftime('%s','now'));
  `);
}

function migrateToV4() {
  /**
   * Off-chain KYC requests.
   *
   * What to store here (recommended):
   * - A canonicalized JSON payload (or encrypted blob)
   * - The user's signature proving wallet ownership
   * - Document references (hash / IPFS CID / S3 key), not raw images inline
   *
   * What NOT to store in plaintext in real life:
   * - National ID numbers, full addresses, selfies, scans.
   * This demo keeps it flexible with payloadJson; you can encrypt it later.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      kycHash TEXT NOT NULL,

      -- Canonicalized payload JSON used to compute kycHash (or encrypted version).
      payloadJson TEXT NOT NULL,

      -- Wallet ownership proof.
      message TEXT,
      signature TEXT,

      -- Document reference (hash/CID/path), NOT the raw file.
      docRef TEXT,

      status TEXT NOT NULL DEFAULT 'PENDING',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER,
      reviewedAt INTEGER,
      reviewer TEXT,
      notes TEXT,

      -- Optional on-chain linkage for approvals/revocations.
      approveTxHash TEXT,
      revokeTxHash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_wallet ON kyc_requests(wallet);
    CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_requests(status);
    CREATE INDEX IF NOT EXISTS idx_kyc_created ON kyc_requests(createdAt);
    CREATE INDEX IF NOT EXISTS idx_kyc_hash ON kyc_requests(kycHash);
  `);

  // KYC action log (audit trail for compliance decisions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId INTEGER,
      wallet TEXT NOT NULL,
      action TEXT NOT NULL,          -- SUBMITTED | APPROVED | REJECTED | REVOKED
      actor TEXT,                    -- admin wallet / system
      txHash TEXT,
      at INTEGER NOT NULL,
      detailsJson TEXT,
      FOREIGN KEY(requestId) REFERENCES kyc_requests(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_actions_wallet ON kyc_actions(wallet);
    CREATE INDEX IF NOT EXISTS idx_kyc_actions_at ON kyc_actions(at);
    CREATE INDEX IF NOT EXISTS idx_kyc_actions_action ON kyc_actions(action);
  `);

  // Backfill: if you already have old rows, keep them consistent.
  // (No-op for fresh DBs.)
  if (tableExists("kyc_requests")) {
    // Ensure new columns exist if DB was created with an earlier draft.
    addColumnIfMissing("kyc_requests", "message TEXT", "message");
    addColumnIfMissing("kyc_requests", "signature TEXT", "signature");
    addColumnIfMissing("kyc_requests", "docRef TEXT", "docRef");
    addColumnIfMissing("kyc_requests", "updatedAt INTEGER", "updatedAt");
    addColumnIfMissing("kyc_requests", "approveTxHash TEXT", "approveTxHash");
    addColumnIfMissing("kyc_requests", "revokeTxHash TEXT", "revokeTxHash");
  }
}

// ---- Run migrations -------------------------------------------------------

function runMigrations() {
  let v = getUserVersion();

  // Wrap in a transaction so we never end up with a half-migrated schema.
  const tx = db.transaction(() => {
    if (v < 1) {
      migrateToV1();
      v = 1;
      setUserVersion(v);
    }
    if (v < 2) {
      migrateToV2();
      v = 2;
      setUserVersion(v);
    }
    if (v < 3) {
      migrateToV3();
      v = 3;
      setUserVersion(v);
    }
    if (v < 4) {
      migrateToV4();
      v = 4;
      setUserVersion(v);
    }
  });

  tx();
  return v;
}

try {
  const version = runMigrations();
  console.log(`DB migrated OK (schema user_version=${version})`);
} catch (e) {
  console.error("DB migration failed:", e);
  process.exitCode = 1;
} finally {
  try {
    db.close();
  } catch {
    // ignore
  }
}
