import 'dotenv/config';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import type { Quote } from './receipt.js';

const API = 'https://api.textilecredit.com/v2';
export type FirmQuoteRequest = { chainId: number; sellToken: `0x${string}`; buyToken: `0x${string}`; sellAmount?: string; buyAmount?: string; taker: `0x${string}`; preferredLiquidityWallets?: string[]; restrictedLiquidityWallets?: string[] };

export async function previewQuote(body: Omit<FirmQuoteRequest, 'taker'>, apiKey = process.env.TEXTILE_API_KEY) {
  return api('/rfq/preview', body, apiKey);
}
export async function requestFirmQuote(body: FirmQuoteRequest, apiKey = process.env.TEXTILE_API_KEY): Promise<Quote> {
  if (Boolean(body.sellAmount) === Boolean(body.buyAmount)) throw new Error('Supply exactly one of sellAmount or buyAmount.');
  // Key-auth is supported here. Keyless flow requires a fresh TakerControl typed signature; don't guess it.
  if (!apiKey) throw new Error('TEXTILE_API_KEY is required for RFQ. Keyless takerProof signing is not configured.');
  const response = await api('/rfq/request', body, apiKey, 75000);
  const data = response.data ?? response;
  if (data.status !== 'quoted' || !data.transactions?.swap || !data.quote?.expiresAt) throw new Error(`Textile returned no usable firm quote: ${JSON.stringify(data.status ?? data)}`);
  return data as Quote;
}
export async function submitQuote(rfqId: string, claimToken: string, txHash: string) {
  return fetch(`${API}/rfq/${encodeURIComponent(rfqId)}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Rfq-Claim': claimToken }, body: JSON.stringify({ txHash }) }).then(checkedJson);
}
async function api(path: string, body: unknown, apiKey?: string, timeout = 15000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const headers: Record<string, string> = { 'content-type': 'application/json' }; if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal }).then(checkedJson);
  } finally { clearTimeout(timer); }
}
async function checkedJson(res: Response) { const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { throw new Error(`Textile API returned non-JSON (${res.status})`); } if (!res.ok) throw new Error(`Textile API ${res.status}: ${JSON.stringify(json)}`); return json; }

export async function takerProof(privateKey: `0x${string}`, chainId: number) {
  const account = privateKeyToAccount(privateKey); const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`; const issuedAt = Date.now();
  const signature = await account.signTypedData({ domain: { name: 'Textile', version: '1', chainId }, types: { TakerControl: [{ name: 'taker', type: 'address' }, { name: 'chainId', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }, { name: 'issuedAt', type: 'uint256' }] }, primaryType: 'TakerControl', message: { taker: account.address, chainId: BigInt(chainId), nonce, issuedAt: BigInt(issuedAt) } });
  return { taker: account.address, takerProof: { nonce, issuedAt, signature } };
}

export function generateReceiptSigningKey() {
  const pair = generateKeyPairSync('ed25519');
  return { privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
export const proofNonce = () => createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex');
