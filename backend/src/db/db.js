import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/src/db/db.js  -> backend root = đi lên 2 cấp
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

export function initDb() {
  // default: backend/data/bankchain.sqlite (absolute path)
  const defaultFile = path.join(BACKEND_ROOT, "data", "bankchain.sqlite");

  // nếu có DB_FILE thì cho phép override (relative sẽ resolve theo BACKEND_ROOT)
  const envFile = process.env.DB_FILE;
  const file = envFile
    ? (path.isAbsolute(envFile) ? envFile : path.resolve(BACKEND_ROOT, envFile))
    : defaultFile;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  return db;
}
