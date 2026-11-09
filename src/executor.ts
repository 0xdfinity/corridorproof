import 'dotenv/config';
import { createPublicClient, createWalletClient, http, type Hex, concat } from 'viem';
import { celo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { toDataSuffix, verifyTx } from '@celo/attribution-tags';
import type { Quote } from './receipt.js';
export const CELO_CHAIN_ID = 42220;
export const ATTRIBUTION_TAG = process.env.LOOPS_ATTRIBUTION_TAG || 'celo_ae47e7a86a7b';
export const ATTRIBUTION_IS_PLACEHOLDER = ATTRIBUTION_TAG === 'corridorproof_placeholder';
const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
export function tagCalldata(data: Hex, code: string = ATTRIBUTION_TAG): Hex {
  const suffix = toDataSuffix(code);
  // One suffix per transaction: ERC-8021 does not stack, and a doubled tag would
  // make the payload unreadable to the verifier.
  if (data.toLowerCase().endsWith(suffix.slice(2).toLowerCase())) return data;
  return concat([data, suffix]);
}

/**
 * The settlement mode decides whether a key exists at all. There is deliberately no
 * default value here: `undefined` used to fall through to the environment key, which
 * is exactly how a "dry run" could broadcast a mainnet transaction.
 */
export function settlementKeyFor(mode: "dry-run" | "live", envKey: string | undefined): string | undefined {
  if (mode === "dry-run") return undefined;
  if (!envKey) throw new Error('No agent wallet configured for this deployment.');
  return envKey;
}

/** Every outbound payload must carry the enrollment tag, with no exceptions. */
function assertTagged(data: Hex, code: string = ATTRIBUTION_TAG) {
  if (!data.toLowerCase().endsWith(toDataSuffix(code).slice(2).toLowerCase())) {
    throw new Error(`Refusing to broadcast: calldata does not end with the attribution tag ${code}.`);
  }
}
export function createExecutor(privateKey = process.env.AGENT_PRIVATE_KEY): { account: any; publicClient: any; walletClient: any } {
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY missing. Executor is configured for dry-run only.');
  const account = privateKeyToAccount(privateKey as Hex);
  return { account, publicClient: createPublicClient({ chain: celo, transport: http(RPC_URL) }), walletClient: createWalletClient({ account, chain: celo, transport: http(RPC_URL) }) };
}
export function createReader() { return createPublicClient({ chain: celo, transport: http(RPC_URL) }); }

/** Read the ERC-8021 codes actually present on a settled transaction. */
export async function readAttribution(txHash: Hex) {
  const result = await verifyTx({ client: createReader(), hash: txHash });
  const codes = result?.codes ?? [];
  return {
    txHash,
    codes,
    schemaId: result ? result.schemaId : null,
    configured: ATTRIBUTION_TAG,
    creditedToEnrollment: codes.includes(ATTRIBUTION_TAG),
    explorer: `https://celoscan.io/tx/${txHash}`,
  };
}

/**
 * An attributed value transfer. This is how enrollment activity starts on a corridor
 * that has no fill yet: the suffix is the tag, and it is verifiable by anyone after.
 */
export async function sendAttributedTransfer(to: Hex, value: bigint, mode: "dry-run" | "live" = "live") {
  const privateKey = settlementKeyFor(mode, process.env.AGENT_PRIVATE_KEY);
  const data = tagCalldata('0x');
  if (mode === "dry-run") return { mode: 'dry-run' as const, to, data, value: value.toString(), chainId: CELO_CHAIN_ID, tag: ATTRIBUTION_TAG };
  assertBroadcastAllowed(data);
  const { walletClient, publicClient, account } = createExecutor(privateKey);
  const hash = await walletClient.sendTransaction({ account, to, data, value, chain: celo });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { mode: 'attributed-transfer' as const, txHash: hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(), from: account.address, to, value: value.toString(), tag: ATTRIBUTION_TAG, data };
}

/** Nothing leaves this module unsigned-and-untagged, and never from a placeholder code. */
function assertBroadcastAllowed(data: Hex) {
  if (ATTRIBUTION_IS_PLACEHOLDER) throw new Error(`Refusing to broadcast: ${ATTRIBUTION_TAG} is an unassigned placeholder, not an issued enrollment code.`);
  assertTagged(data);
}

export async function executeSwap(quote: Quote, mode: "dry-run" | "live" = "dry-run") {
  if (quote.transactions.swap.chainId !== CELO_CHAIN_ID) throw new Error(`Wrong quote chain ${quote.transactions.swap.chainId}, expected Celo ${CELO_CHAIN_ID}.`);
  if (Date.now() >= Date.parse(quote.quote.expiresAt)) throw new Error('Firm quote expired; request another quote.');
  const data = tagCalldata(quote.transactions.swap.data);
  const privateKey = settlementKeyFor(mode, process.env.AGENT_PRIVATE_KEY);
  if (mode === "dry-run") return { mode: 'dry-run' as const, to: quote.transactions.swap.to, data, chainId: CELO_CHAIN_ID, value: quote.transactions.swap.value, tag: ATTRIBUTION_TAG, placeholder: ATTRIBUTION_IS_PLACEHOLDER };
  assertBroadcastAllowed(data);
  const { walletClient, publicClient, account } = createExecutor(privateKey);
  if (quote.quote.taker && account.address.toLowerCase() !== quote.quote.taker.toLowerCase()) throw new Error('Quote is bound to a different taker wallet.');
  const hash = await walletClient.sendTransaction({ account, to: quote.transactions.swap.to, data, value: BigInt(quote.transactions.swap.value), chain: celo });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { mode: 'settled' as const, txHash: hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(), tag: ATTRIBUTION_TAG, placeholder: ATTRIBUTION_IS_PLACEHOLDER };
}
