import dotenv from "dotenv";
import { initDb } from "../db/db.js";
import { getContracts, getProvider } from "../web3/web3.js";

dotenv.config();

const once = process.argv.includes("--once");
const db = initDb();

function normalizeAddr(a) {
  return (a || "").toLowerCase();
}

async function blockTimestamp(provider, blockNumber) {
  const block = await provider.getBlock(blockNumber);
  return block?.timestamp || null;
}

async function indexOnce() {
  const provider = getProvider();
  const { vault, lending } = await getContracts();

  const latest = await provider.getBlockNumber();
  const lastIndexedRow = db.prepare("SELECT MAX(blockNumber) as b FROM events").get();
  const fromBlock = (lastIndexedRow?.b ?? 0);

  // To avoid re-reading the deployment block as 0 always, start at fromBlock+1
  const start = fromBlock === 0 ? 0 : fromBlock + 1;

  const events = [];

  // Vault events
  const vaultEvents = [
    { name: "Deposited", iface: vault.interface },
    { name: "Withdrawn", iface: vault.interface },
    { name: "TransferBKD", iface: vault.interface },
  ];

  for (const ev of vaultEvents) {
    const logs = await provider.getLogs({
      address: vault.target,
      fromBlock: start,
      toBlock: latest,
      topics: [vault.interface.getEvent(ev.name).topicHash],
    });
    for (const l of logs) {
      const parsed = vault.interface.parseLog(l);
      events.push({
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eventName: ev.name,
        fromAddr: normalizeAddr(parsed.args.from ?? parsed.args.user ?? ""),
        toAddr: normalizeAddr(parsed.args.to ?? ""),
        amount: (parsed.args.amount ?? parsed.args.mintedBKD ?? parsed.args.burnedBKD ?? "").toString(),
      });
    }
  }

  // Lending events
  const lendingEvents = [
    "CollateralDeposited",
    "CollateralWithdrawn",
    "Borrowed",
    "Repaid",
  ];

  for (const name of lendingEvents) {
    const logs = await provider.getLogs({
      address: lending.target,
      fromBlock: start,
      toBlock: latest,
      topics: [lending.interface.getEvent(name).topicHash],
    });
    for (const l of logs) {
      const parsed = lending.interface.parseLog(l);
      events.push({
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        eventName: name,
        fromAddr: normalizeAddr(parsed.args.user ?? ""),
        toAddr: "",
        amount: (parsed.args.amount ?? "").toString(),
      });
    }
  }

  // sort by blockNumber for deterministic inserts
  events.sort((a, b) => a.blockNumber - b.blockNumber);

  const insert = db.prepare(`
    INSERT INTO events (blockNumber, txHash, eventName, fromAddr, toAddr, amount, timestamp)
    VALUES (@blockNumber, @txHash, @eventName, @fromAddr, @toAddr, @amount, @timestamp)
  `);

  let inserted = 0;
  for (const e of events) {
    const ts = await blockTimestamp(provider, e.blockNumber);
    insert.run({ ...e, timestamp: ts });
    inserted++;
  }

  return { latest, start, inserted };
}

async function main() {
  try {
    const res = await indexOnce();
    console.log("Indexed:", res);
    if (once) process.exit(0);

    console.log("Indexer running (poll every 3s) ...");
    setInterval(async () => {
      try {
        const r = await indexOnce();
        if (r.inserted) console.log("Indexed:", r);
      } catch (e) {
        console.error("index error:", e.message);
      }
    }, 3000);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
