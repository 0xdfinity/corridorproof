import 'dotenv/config';
import { createHash, createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';

export type Quote = { rfqId: string; status: string; quote: { sellAmount: string; buyAmount: string; takerPays?: string; rateRay?: string; expiresAt: string; taker?: string; orders?: Array<{ maker?: string }> }; routing?: Record<string, unknown>; transactions: { swap: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number } } };
export type Settlement = { txHash: `0x${string}`; settledAt: string; sellAmount: string; buyAmount: string; rateRay?: string; route?: string[]; blockNumber?: string };
export type ReceiptInput = { quote: Quote; settlement: Settlement; slippageBpsLimit?: number; provenance?: Provenance };
/** Where the fill numbers came from. A chain read is evidence; a typed amount is a claim. */
export type Provenance = { source: 'declared' | 'chain'; tagVerified: boolean; txHash?: string };
export type Receipt = { id: string; createdAt: string; chainId: number; rfqId: string; txHash: string; quote: { sellAmount: string; buyAmount: string; rateRay: string | null; expiresAt: string; route: string[] }; fill: { sellAmount: string; buyAmount: string; rateRay: string | null; settledAt: string; route: string[] }; comparison: { rateDeltaBps: number | null; slippageBps: number; slippageLimitBps: number; expiryHonored: boolean; routeMatched: boolean; verified: boolean; flags: string[] }; provenance: Provenance; signature: { algorithm: 'ed25519'; publicKey: string; value: string; payloadHash: string } };
const routeOfQuote = (q: Quote) => { const makers = (q.quote.orders || []).map(o => o.maker).filter((x): x is string => !!x); return makers.length ? makers : ['Textile RFQ']; };
const parseRate = (sell: string, buy: string, rateRay?: string) => rateRay ? Number(rateRay) / 1e27 : Number(buy) / Number(sell);
const bps = (actual: number, baseline: number) => baseline === 0 ? 0 : Math.round((actual / baseline - 1) * 10000 * 100) / 100;
export function makeReceipt({ quote, settlement, slippageBpsLimit = 100, provenance }: ReceiptInput, privateKeyPem = process.env.RECEIPT_PRIVATE_KEY_PEM): Receipt {
  if (!privateKeyPem) throw new Error('Receipt signing key is required. Set RECEIPT_PRIVATE_KEY_PEM.');
  const qRate = parseRate(quote.quote.sellAmount, quote.quote.buyAmount, quote.quote.rateRay), fRate = parseRate(settlement.sellAmount, settlement.buyAmount, settlement.rateRay);
  const rateDeltaBps = bps(fRate, qRate), slippageBps = Math.max(0, Math.round(-rateDeltaBps * 100) / 100), slippageLimitBps = slippageBpsLimit;
  const quoteRoute = routeOfQuote(quote), fillRoute = settlement.route ?? quoteRoute;
  const expiryHonored = Date.parse(settlement.settledAt) <= Date.parse(quote.quote.expiresAt), routeMatched = JSON.stringify([...quoteRoute].sort()) === JSON.stringify([...fillRoute].sort());
  const flags: string[] = []; if (!expiryHonored) flags.push('expiry-violation'); if (!routeMatched) flags.push('route-mismatch'); if (slippageBps > slippageBpsLimit) flags.push('slippage-exceeded');
  const body: Omit<Receipt, 'signature'> = { id: randomUUID(), createdAt: new Date().toISOString(), chainId: quote.transactions.swap.chainId, rfqId: quote.rfqId, txHash: settlement.txHash, provenance: provenance ?? { source: 'declared', tagVerified: false },
    quote: { sellAmount: quote.quote.sellAmount, buyAmount: quote.quote.buyAmount, rateRay: quote.quote.rateRay ?? null, expiresAt: quote.quote.expiresAt, route: quoteRoute },
    fill: { sellAmount: settlement.sellAmount, buyAmount: settlement.buyAmount, rateRay: settlement.rateRay ?? null, settledAt: settlement.settledAt, route: fillRoute },
    comparison: { rateDeltaBps, slippageBps, slippageLimitBps, expiryHonored, routeMatched, verified: expiryHonored && routeMatched && slippageBps <= slippageBpsLimit, flags } };
  const payload = JSON.stringify(body), priv = createPrivateKey(privateKeyPem), pub = createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
  return { ...body, signature: { algorithm: 'ed25519', publicKey: pub, value: sign(null, Buffer.from(payload), priv).toString('base64'), payloadHash: createHash('sha256').update(payload).digest('hex') } };
}
export function verifyReceipt(receipt: Receipt): boolean { try { const { signature, ...body } = receipt, payload = JSON.stringify(body); return createHash('sha256').update(payload).digest('hex') === signature.payloadHash && verify(null, Buffer.from(payload), createPublicKey(signature.publicKey), Buffer.from(signature.value, 'base64')); } catch { return false; } }
