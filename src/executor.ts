import 'dotenv/config';
import { createPublicClient, createWalletClient, http, type Hex, concat } from 'viem';
import { celo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { toDataSuffix } from '@celo/attribution-tags';
import type { Quote } from './receipt.js';
export const CELO_CHAIN_ID = 42220;
export const ATTRIBUTION_TAG = process.env.LOOPS_ATTRIBUTION_TAG || 'corridorproof_placeholder';
export const ATTRIBUTION_IS_PLACEHOLDER = !process.env.LOOPS_ATTRIBUTION_TAG;
const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
export function tagCalldata(data: Hex, code: string = ATTRIBUTION_TAG): Hex { return concat([data, toDataSuffix(code)]); }
export function createExecutor(privateKey = process.env.AGENT_PRIVATE_KEY): { account: any; publicClient: any; walletClient: any } {
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY missing. Executor is configured for dry-run only.');
  const account = privateKeyToAccount(privateKey as Hex);
  return { account, publicClient: createPublicClient({ chain: celo, transport: http(RPC_URL) }), walletClient: createWalletClient({ account, chain: celo, transport: http(RPC_URL) }) };
}
export async function executeSwap(quote: Quote, privateKey = process.env.AGENT_PRIVATE_KEY) {
  if (quote.transactions.swap.chainId !== CELO_CHAIN_ID) throw new Error(`Wrong quote chain ${quote.transactions.swap.chainId}, expected Celo ${CELO_CHAIN_ID}.`);
  if (Date.now() >= Date.parse(quote.quote.expiresAt)) throw new Error('Firm quote expired; request another quote.');
  const data = tagCalldata(quote.transactions.swap.data);
  if (!privateKey) return { mode: 'dry-run' as const, to: quote.transactions.swap.to, data, chainId: CELO_CHAIN_ID, value: quote.transactions.swap.value, tag: ATTRIBUTION_TAG, placeholder: ATTRIBUTION_IS_PLACEHOLDER };
  const { walletClient, publicClient, account } = createExecutor(privateKey);
  if (quote.quote.taker && account.address.toLowerCase() !== quote.quote.taker.toLowerCase()) throw new Error('Quote is bound to a different taker wallet.');
  const hash = await walletClient.sendTransaction({ account, to: quote.transactions.swap.to, data, value: BigInt(quote.transactions.swap.value), chain: celo });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { mode: 'settled' as const, txHash: hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(), tag: ATTRIBUTION_TAG, placeholder: ATTRIBUTION_IS_PLACEHOLDER };
}
