import { createReader, readAttribution, CELO_CHAIN_ID } from './executor.js';
import type { Hex } from 'viem';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export type TokenTransfer = { token: string; from: string; to: string; amount: string };

export type ObservedFill = {
  txHash: string;
  chainId: number;
  blockNumber: string;
  settledAt: string;
  taker: string;
  sender: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  makers: string[];
  transfers: TokenTransfer[];
  attribution: { codes: string[]; creditedToEnrollment: boolean };
  verified: boolean;
  reasons: string[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const addr = (topic: string) => `0x${topic.slice(26).toLowerCase()}` as Hex;

/**
 * Reads what a settlement actually moved, from the chain's own logs, instead of
 * accepting amounts a caller typed in. A receipt built on this is evidence; one
 * built on declarations is an assertion.
 */
export async function observeSettlement(input: {
  txHash: Hex;
  taker: Hex;
  sellToken: Hex;
  buyToken: Hex;
}): Promise<ObservedFill> {
  const client = createReader();
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: input.txHash }),
    client.getTransaction({ hash: input.txHash }),
  ]);
  // The block is keyed off the receipt, so it cannot join the same Promise.all.
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });

  const transfers: TokenTransfer[] = [];
  for (const log of receipt.logs) {
    // ERC-20 Transfer is one signature topic plus two indexed addresses.
    if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC) continue;
    transfers.push({ token: log.address, from: addr(log.topics[1]), to: addr(log.topics[2]), amount: BigInt(log.data).toString() });
  }

  const sold = transfers.filter((t) => same(t.from, input.taker) && same(t.token, input.sellToken));
  const bought = transfers.filter((t) => same(t.to, input.taker) && same(t.token, input.buyToken));
  const sellAmount = sold.reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const buyAmount = bought.reduce((sum, t) => sum + BigInt(t.amount), 0n);

  const attribution = await readAttribution(input.txHash);
  const reasons: string[] = [];
  if (receipt.status !== 'success') reasons.push('transaction reverted');
  if (sellAmount === 0n) reasons.push('no transfer out of the taker for the sell token');
  if (buyAmount === 0n) reasons.push('no transfer into the taker for the buy token');
  if (!attribution.creditedToEnrollment) reasons.push('transaction does not carry the enrollment tag');

  return {
    txHash: input.txHash,
    chainId: CELO_CHAIN_ID,
    blockNumber: receipt.blockNumber.toString(),
    settledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    taker: input.taker,
    sender: tx.from,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: sellAmount.toString(),
    buyAmount: buyAmount.toString(),
    makers: [...new Set(bought.map((t) => t.from))],
    transfers,
    attribution: { codes: attribution.codes, creditedToEnrollment: attribution.creditedToEnrollment },
    verified: reasons.length === 0,
    reasons,
  };
}
