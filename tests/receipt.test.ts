import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { toDataSuffix } from '@celo/attribution-tags';
import type { Hex } from 'viem';
import { makeReceipt, verifyReceipt, type Quote } from '../src/receipt.js';
import { ATTRIBUTION_IS_PLACEHOLDER, ATTRIBUTION_TAG, tagCalldata } from '../src/executor.js';
const calldataFixtures: Hex[] = ['0x1234', '0xabcdef', `0x${'00'.repeat(32)}`];

describe('Celo attribution calldata', () => {
  it('appends the configured enrollment tag to every built calldata payload', () => {
    expect(ATTRIBUTION_TAG).toBe('celo_ae47e7a86a7b');
    expect(ATTRIBUTION_IS_PLACEHOLDER).toBe(false);
    const suffix = toDataSuffix(ATTRIBUTION_TAG);
    for (const payload of calldataFixtures) {
      const built = tagCalldata(payload);
      expect(built).toContain(Buffer.from(ATTRIBUTION_TAG).toString('hex'));
      expect(built.endsWith(suffix.slice(2))).toBe(true);
    }
  });
});

const pair = generateKeyPairSync('ed25519');
const key = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const q: Quote = { rfqId: 'rfq_test', status: 'quoted', quote: { sellAmount: '1000', buyAmount: '900', rateRay: '900000000000000000000000000', expiresAt: '2026-12-01T00:00:00.000Z', orders: [{ maker: 'maker-a' }] }, transactions: { swap: { to: '0x0000000000000000000000000000000000000001', data: '0x1234', value: '0', chainId: 42220 } } };
describe('receipt engine', () => {
  it('signs and verifies a compliant receipt', () => { const r = makeReceipt({ quote: q, settlement: { txHash: '0xabc', settledAt: '2026-11-30T23:59:00.000Z', sellAmount: '1000', buyAmount: '899', route: ['maker-a'] }, slippageBpsLimit: 100 }, key); expect(r.comparison.verified).toBe(true); expect(verifyReceipt(r)).toBe(true); });
  it('flags expiry violation', () => { const r = makeReceipt({ quote: q, settlement: { txHash: '0xdef', settledAt: '2026-12-01T00:00:01.000Z', sellAmount: '1000', buyAmount: '900' } }, key); expect(r.comparison.expiryHonored).toBe(false); expect(r.comparison.flags).toContain('expiry-violation'); expect(r.comparison.verified).toBe(false); });
  it('flags adverse slippage beyond threshold', () => { const r = makeReceipt({ quote: q, settlement: { txHash: '0x123', settledAt: '2026-11-30T23:59:00.000Z', sellAmount: '1000', buyAmount: '880' }, slippageBpsLimit: 100 }, key); expect(r.comparison.slippageBps).toBeGreaterThan(100); expect(r.comparison.flags).toContain('slippage-exceeded'); });
  it('flags a route mismatch and detects tampering', () => { const r = makeReceipt({ quote: q, settlement: { txHash: '0x124', settledAt: '2026-11-30T23:59:00.000Z', sellAmount: '1000', buyAmount: '900', route: ['maker-b'] } }, key); expect(r.comparison.routeMatched).toBe(false); expect(verifyReceipt({ ...r, rfqId: 'changed' })).toBe(false); });
});
