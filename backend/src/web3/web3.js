import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/src/web3/web3.js -> backend root: đi lên 2 cấp (web3 -> src -> backend)
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
// project root: đi lên 1 cấp nữa (backend -> bankchain root)
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");

const DEFAULT_CONTRACTS_JSON = path.join(PROJECT_ROOT, "contracts.json");
const DEFAULT_ARTIFACTS_ROOT = path.join(PROJECT_ROOT, "contracts", "artifacts", "contracts");

console.log("PROJECT_ROOT =", PROJECT_ROOT);
console.log("contracts.json =", DEFAULT_CONTRACTS_JSON);
console.log("artifactsRoot =", DEFAULT_ARTIFACTS_ROOT);

function resolveFromProjectRoot(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

function loadContractsJson() {
  const fromEnv = resolveFromProjectRoot(process.env.CONTRACTS_JSON);
  const abs = (fromEnv && fs.existsSync(fromEnv)) ? fromEnv : DEFAULT_CONTRACTS_JSON;
  return JSON.parse(fs.readFileSync(abs, "utf-8"));
}


export function getProvider() {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(rpc);
}

export async function getAdminSigner() {
  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk || pk.includes("REPLACE_WITH")) throw new Error("ADMIN_PRIVATE_KEY not set in backend/.env");
  return new ethers.Wallet(pk, getProvider());
}

/**
 * Load ABIs from the contracts workspace artifacts folder.
 * This keeps the backend in sync with the contracts.
 */
function loadAbi(contractName) {
  const envRoot = resolveFromProjectRoot(process.env.CONTRACTS_ARTIFACTS);
  const artifactsRoot = (envRoot && fs.existsSync(envRoot)) ? envRoot : DEFAULT_ARTIFACTS_ROOT;

  const candidates = [
    path.join(artifactsRoot, `${contractName}.sol`, `${contractName}.json`),
    path.join(artifactsRoot, contractName, `${contractName}.json`),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const json = JSON.parse(fs.readFileSync(c, "utf-8"));
      return json.abi;
    }
  }

  throw new Error(
    `ABI not found for ${contractName}. Looked in:\n` + candidates.join("\n")
  );
}


export function getAbi(contractName) {
  return loadAbi(contractName);
}


export async function getContractsMeta() {
  // JSON-serializable, safe to return to the UI.
  return loadContractsJson();
}

export async function getContracts() {
  const cfg = loadContractsJson();
  const provider = getProvider();

  const kycAbi = loadAbi("KYCRegistry");
  const tokenAbi = loadAbi("DepositToken");
  const vaultAbi = loadAbi("BankVault");
  const lendingAbi = loadAbi("LendingPool");

  const kyc = new ethers.Contract(cfg.contracts.KYCRegistry, kycAbi, provider);
  const token = new ethers.Contract(cfg.contracts.DepositToken, tokenAbi, provider);
  const vault = new ethers.Contract(cfg.contracts.BankVault, vaultAbi, provider);
  const lending = new ethers.Contract(cfg.contracts.LendingPool, lendingAbi, provider);

  return { cfg, kyc, token, vault, lending };
}

