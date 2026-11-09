import 'dotenv/config';
import Database from 'better-sqlite3';
import { createHash, createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Quote = { rfqId: string; status: string; quote: { sellAmount: string; buyAmount: string; takerPays?: string; rateRay?: string; expiresAt: string; taker?: string; orders?: Array<{ maker?: string }> }; routing?: Record<string, unknown>; transactions: { swap: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number } } };
export type Settlement = { txHash: `0x${string}`; settledAt: string; sellAmount: string; buyAmount: string; rateRay?: string; route?: string[]; blockNumber?: string };
export type ReceiptInput = { quote: Quote; settlement: Settlement; slippageBpsLimit?: number };
export type Receipt = { id: string; createdAt: string; chainId: number; rfqId: string; txHash: string; quote: { sellAmount: string; buyAmount: string; rateRay: string | null; expiresAt: string; route: string[] }; fill: { sellAmount: string; buyAmount: string; rateRay: string | null; settledAt: string; route: string[] }; comparison: { rateDeltaBps: number | null; slippageBps: number; slippageLimitBps: number; expiryHonored: boolean; routeMatched: boolean; verified: boolean; flags: string[] }; signature: { algorithm: 'ed25519'; publicKey: string; value: string; payloadHash: string } };
const routeOfQuote = (q: Quote) => { const makers = (q.quote.orders || []).map(o => o.maker).filter((x): x is string => !!x); return makers.length ? makers : ['Textile RFQ']; };
const parseRate = (sell: string, buy: string, rateRay?: string) => rateRay ? Number(rateRay) / 1e27 : Number(buy) / Number(sell);
const bps = (actual: number, baseline: number) => baseline === 0 ? 0 : Math.round((actual / baseline - 1) * 10000 * 100) / 100;
export function makeReceipt({ quote, settlement, slippageBpsLimit = 100 }: ReceiptInput, privateKeyPem = process.env.RECEIPT_PRIVATE_KEY_PEM): Receipt {
  if (!privateKeyPem) throw new Error('Receipt signing key is required. Set RECEIPT_PRIVATE_KEY_PEM.');
  const qRate = parseRate(quote.quote.sellAmount, quote.quote.buyAmount, quote.quote.rateRay), fRate = parseRate(settlement.sellAmount, settlement.buyAmount, settlement.rateRay);
  const rateDeltaBps = bps(fRate, qRate), slippageBps = Math.max(0, Math.round(-rateDeltaBps * 100) / 100), slippageLimitBps = slippageBpsLimit;
  const quoteRoute = routeOfQuote(quote), fillRoute = settlement.route ?? quoteRoute;
  const expiryHonored = Date.parse(settlement.settledAt) <= Date.parse(quote.quote.expiresAt), routeMatched = JSON.stringify([...quoteRoute].sort()) === JSON.stringify([...fillRoute].sort());
  const flags: string[] = []; if (!expiryHonored) flags.push('expiry-violation'); if (!routeMatched) flags.push('route-mismatch'); if (slippageBps > slippageBpsLimit) flags.push('slippage-exceeded');
  const body: Omit<Receipt, 'signature'> = { id: randomUUID(), createdAt: new Date().toISOString(), chainId: quote.transactions.swap.chainId, rfqId: quote.rfqId, txHash: settlement.txHash,
    quote: { sellAmount: quote.quote.sellAmount, buyAmount: quote.quote.buyAmount, rateRay: quote.quote.rateRay ?? null, expiresAt: quote.quote.expiresAt, route: quoteRoute },
    fill: { sellAmount: settlement.sellAmount, buyAmount: settlement.buyAmount, rateRay: settlement.rateRay ?? null, settledAt: settlement.settledAt, route: fillRoute },
    comparison: { rateDeltaBps, slippageBps, slippageLimitBps, expiryHonored, routeMatched, verified: expiryHonored && routeMatched && slippageBps <= slippageBpsLimit, flags } };
  const payload = JSON.stringify(body), priv = createPrivateKey(privateKeyPem), pub = createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
  return { ...body, signature: { algorithm: 'ed25519', publicKey: pub, value: sign(null, Buffer.from(payload), priv).toString('base64'), payloadHash: createHash('sha256').update(payload).digest('hex') } };
}
export function verifyReceipt(receipt: Receipt): boolean { try { const { signature, ...body } = receipt, payload = JSON.stringify(body); return createHash('sha256').update(payload).digest('hex') === signature.payloadHash && verify(null, Buffer.from(payload), createPublicKey(signature.publicKey), Buffer.from(signature.value, 'base64')); } catch { return false; } }
export class ReceiptStore {
  private db: Database.Database; private jsonPath: string;
  constructor(filename = process.env.RECEIPT_DB || '.data/receipts.sqlite') { const path = resolve(filename); mkdirSync(dirname(path), { recursive: true }); this.jsonPath = path.replace(/\.sqlite$/, '.jsonl'); this.db = new Database(path); this.db.exec('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, tx_hash TEXT NOT NULL, payload TEXT NOT NULL)'); }
  put(receipt: Receipt) { const payload = JSON.stringify(receipt); this.db.prepare('INSERT OR REPLACE INTO receipts VALUES (?, ?, ?, ?)').run(receipt.id, receipt.createdAt, receipt.txHash, payload); appendFileSync(this.jsonPath, payload + '\n'); }
  get(id: string): Receipt | null { const row = this.db.prepare('SELECT payload FROM receipts WHERE id=? OR tx_hash=?').get(id, id) as { payload: string } | undefined; return row ? JSON.parse(row.payload) : null; }
  list(limit = 50): Receipt[] { return this.db.prepare('SELECT payload FROM receipts ORDER BY created_at DESC LIMIT ?').all(limit).map((r: any) => JSON.parse(r.payload)); }
}
