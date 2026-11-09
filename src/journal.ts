import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Receipt } from "./receipt.js";

export interface Journal {
  /** Where receipts actually live. The UI states this so nobody assumes a lost journal is a lost signature. */
  readonly persistence: "sqlite" | "jsonl";
  readonly location: string;
  put(receipt: Receipt): void;
  get(id: string): Receipt | null;
  list(limit?: number): Receipt[];
}

/**
 * Append-only newline-delimited receipts. Serverless request handlers get a writable
 * scratch path rather than a persistent volume, so this is also the honest ceiling there.
 */
export class JsonlJournal implements Journal {
  readonly persistence = "jsonl" as const;
  private rows: Receipt[] = [];
  constructor(readonly location: string) {
    mkdirSync(dirname(resolve(location)), { recursive: true });
    if (existsSync(resolve(location))) {
      for (const line of readFileSync(location, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { this.rows.push(JSON.parse(line)); } catch { /* a torn final line is not a corrupted journal */ }
      }
    }
  }
  put(receipt: Receipt) {
    this.rows = this.rows.filter((r) => r.id !== receipt.id);
    this.rows.push(receipt);
    appendFileSync(resolve(this.location), JSON.stringify(receipt) + "\n");
  }
  get(id: string) {
    return this.rows.find((r) => r.id === id || r.txHash === id) ?? null;
  }
  list(limit = 50) {
    return [...this.rows].reverse().slice(0, limit);
  }
}

/** SQLite for a machine that keeps its own disk. */
export class SqliteJournal implements Journal {
  readonly persistence = "sqlite" as const;
  constructor(readonly location: string, private db: any) {
    db.exec("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, tx_hash TEXT NOT NULL, payload TEXT NOT NULL)");
  }
  static async open(location: string): Promise<SqliteJournal> {
    const path = resolve(location);
    mkdirSync(dirname(path), { recursive: true });
    const { default: Database } = await import("better-sqlite3");
    return new SqliteJournal(location, new Database(path));
  }
  put(receipt: Receipt) {
    this.db.prepare("INSERT OR REPLACE INTO receipts VALUES (?, ?, ?, ?)").run(receipt.id, receipt.createdAt, receipt.txHash, JSON.stringify(receipt));
  }
  get(id: string) {
    const row = this.db.prepare("SELECT payload FROM receipts WHERE id=? OR tx_hash=?").get(id, id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Receipt) : null;
  }
  list(limit = 50) {
    return this.db.prepare("SELECT payload FROM receipts ORDER BY created_at DESC LIMIT ?").all(limit).map((r: any) => JSON.parse(r.payload));
  }
}

/** Self-hosted prefers SQLite and degrades to JSONL; hosted deployments never load the native driver. */
export async function openJournal(filename: string, allowSqlite: boolean): Promise<Journal> {
  if (allowSqlite) {
    try { return await SqliteJournal.open(filename); } catch { /* fall through to the portable journal */ }
  }
  return new JsonlJournal(filename.replace(/\.sqlite$/, ".jsonl"));
}
