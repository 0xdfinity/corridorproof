import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { previewQuote, requestFirmQuote } from "./textile.js";
import { executeSwap, readAttribution, sendAttributedTransfer, ATTRIBUTION_IS_PLACEHOLDER, ATTRIBUTION_TAG, CELO_CHAIN_ID } from "./executor.js";
import { makeReceipt, verifyReceipt, type Receipt } from "./receipt.js";
import { openJournal, type Journal } from "./journal.js";

export type Reply = { status: number; body: unknown };

/**
 * Structural shapes for a Vercel Node handler. Declared here instead of pulling
 * @vercel/node so the functions stay installable from this repo alone.
 */
export type RequestLike = { method?: string; body?: unknown; query?: Record<string, unknown>; params?: Record<string, string>; headers?: Record<string, unknown> };
export type ResponseLike = { status(code: number): { json(body: unknown): void } };

/** Route verbs differ only in the action they name, so one adapter covers every function. */
export async function route(request: RequestLike, response: ResponseLike, actions: { GET?: string; POST?: string }) {
  const method = (request.method || "GET").toUpperCase();
  const action = method === "GET" ? actions.GET : method === "POST" ? actions.POST : undefined;
  if (!action) {
    response.status(405).json({ error: `Use ${[actions.GET && "GET", actions.POST && "POST"].filter(Boolean).join(" or ")}.` });
    return;
  }
  const payload = method === "GET" ? { ...asRecord(request.query), ...asRecord(request.body) } : asRecord(request.body);
  const { status, body } = await handle(action, payload, asRecord(request.headers));
  response.status(status).json(body);
}

const bad = (message: string): Reply => ({ status: 400, body: { error: message } });
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const upstream = (message: string): Reply => ({ status: 502, body: { error: message } });
const ok = (body: unknown): Reply => ({ status: 200, body });

/**
 * One journal per warm process. Serverless instances are short-lived, so this is a
 * cache rather than durable storage; `persistence` in the responses says which it is.
 */
let journalPromise: Promise<Journal> | null = null;
function journal(): Promise<Journal> {
  if (!journalPromise) {
    const hosted = Boolean(process.env.VERCEL);
    const file = resolve(process.env.RECEIPT_DB || (hosted ? "/tmp/corridorproof/receipts.sqlite" : ".data/receipts.sqlite"));
    journalPromise = openJournal(file, !hosted);
  }
  return journalPromise;
}

/** Prefer an injected PEM; otherwise keep a stable local key on disk so old receipts stay verifiable. */
function signingKey(): string {
  if (process.env.RECEIPT_PRIVATE_KEY_PEM) return process.env.RECEIPT_PRIVATE_KEY_PEM;
  const path = resolve(process.env.RECEIPT_SIGNING_KEY || ".data/receipt-ed25519.pem");
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(path, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  }
  return readFileSync(path, "utf8");
}

const amount = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{1,128}$/.test(v);
const address = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const timestamp = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Only a quote this service shaped can reach the settlement path. */
function assertQuote(q: any) {
  const shape = assertQuotable(q);
  if (shape) return shape;
  const swap = q.transactions?.swap;
  if (!swap || !hash(swap.to) || !hash(swap.data)) return "quote.transactions.swap incomplete";
  return null;
}

/** A receipt compares numbers and a window, so it does not need executable calldata. */
function assertQuotable(q: any) {
  if (!q || typeof q !== "object") return "quote object required";
  if (!q.quote || typeof q.quote !== "object") return "quote.quote required";
  if (!amount(q.quote.sellAmount) || !amount(q.quote.buyAmount)) return "quote amounts must be decimal integer strings";
  if (!timestamp(q.quote.expiresAt)) return "quote.expiresAt must be an ISO timestamp";
  const chainId = q.transactions?.swap?.chainId ?? q.chainId ?? CELO_CHAIN_ID;
  if (chainId !== CELO_CHAIN_ID) return `quote is for chain ${chainId}, this service settles Celo ${CELO_CHAIN_ID} only`;
  return null;
}

/** Normalises a full RFQ quote, or a plain recorded quote, into what the receipt engine reads. */
function asQuote(q: any): any {
  const chainId = q.transactions?.swap?.chainId ?? q.chainId ?? CELO_CHAIN_ID;
  return {
    rfqId: typeof q.rfqId === "string" ? q.rfqId : "recorded",
    status: q.status ?? "recorded",
    quote: q.quote,
    transactions: { swap: { ...(q.transactions?.swap ?? {}), chainId } },
  };
}

/**
 * Quotes this server actually issued, keyed by a one-time nonce. Settlement reads the
 * calldata back from here rather than from the request, so a caller cannot hand the
 * service arbitrary `to` and `data` and have a funded wallet sign it.
 */
const issued = new Map<string, { quote: unknown; expiresAt: number }>();
function remember(quote: unknown, expiresAt: string) {
  const nonce = crypto.randomUUID();
  issued.set(nonce, { quote, expiresAt: Date.parse(expiresAt) || Date.now() + 60_000 });
  for (const [key, value] of issued) if (value.expiresAt < Date.now()) issued.delete(key);
  return nonce;
}
function redeem(nonce: unknown) {
  if (typeof nonce !== "string") return null;
  const entry = issued.get(nonce);
  if (!entry) return null;
  issued.delete(nonce);
  return entry;
}

/** Operator arming for broadcast. Off by default, because a reachable server is not a trusted client. */
function settlementArmed() {
  const token = process.env.SETTLEMENT_TOKEN;
  return Boolean(process.env.AGENT_PRIVATE_KEY) && Boolean(token);
}

export async function handle(action: string, payload: any = {}, headers: Record<string, unknown> = {}): Promise<Reply> {
  try {
    switch (action) {
      case "health": {
        const store = await journal();
        return ok({
          ok: true,
          chainId: CELO_CHAIN_ID,
          attributionTag: ATTRIBUTION_TAG,
          attributionCredited: !ATTRIBUTION_IS_PLACEHOLDER,
          settlement: process.env.AGENT_PRIVATE_KEY ? "enabled" : "dry-run",
          rfq: process.env.TEXTILE_API_KEY ? "enabled" : "preview-only",
          persistence: store.persistence,
        });
      }
      case "quote.preview": {
        if (!amount(payload?.sellAmount) && !amount(payload?.buyAmount)) return bad("Provide sellAmount or buyAmount as a decimal integer string.");
        return ok(await previewQuote(payload));
      }
      case "quote.firm": {
        if (!hash(payload?.taker)) return bad("taker must be a wallet address.");
        const quote = await requestFirmQuote(payload);
        const settleNonce = remember(quote, quote.quote.expiresAt);
        return ok({ ...quote, settleNonce });
      }
      case "settle.dry-run": {
        const invalid = assertQuote(payload?.quote);
        if (invalid) return bad(invalid);
        // Dry run cannot reach a key, whatever the environment holds.
        return ok(await executeSwap(asQuote(payload.quote), "dry-run"));
      }
      case "settle": {
        if (!settlementArmed()) {
          return bad("Broadcast is not armed on this deployment. It needs both an agent wallet and SETTLEMENT_TOKEN.");
        }
        if (String(headers["x-settlement-token"] ?? "") !== process.env.SETTLEMENT_TOKEN) {
          return { status: 401, body: { error: "Settlement requires the operator token in X-Settlement-Token." } };
        }
        const entry = redeem(payload?.settleNonce);
        if (!entry) return bad("Unknown or already-used settlement nonce. Request a firm quote here first; settlement only accepts quotes this service issued.");
        return ok(await executeSwap(asQuote(entry.quote), "live"));
      }
      case "attribution.read": {
        if (!hash(payload?.txHash)) return bad("txHash must be a Celo transaction hash.");
        return ok(await readAttribution(payload.txHash));
      }
      case "attribution.send": {
        if (!address(payload?.to)) return bad("to must be a Celo address.");
        if (!amount(payload?.value)) return bad("value must be a decimal wei string.");
        // Broadcasting spends the operator's own gas, so it stays off unless deliberately armed.
        if (process.env.ATTRIBUTION_ALLOW_TX !== "yes" || !process.env.AGENT_PRIVATE_KEY) {
          return bad("This deployment will not broadcast. Set ATTRIBUTION_ALLOW_TX=yes alongside an agent wallet to send attributed activity.");
        }
        const result = await sendAttributedTransfer(payload.to, BigInt(payload.value), "live");
        const proof = await readAttribution(result.txHash);
        return ok({ ...result, proof });
      }
      case "receipt.list": {
        const store = await journal();
        return ok({ receipts: store.list(), persistence: store.persistence });
      }
      case "receipt.get": {
        const store = await journal();
        const receipt = store.get(String(payload?.id ?? ""));
        return receipt ? ok({ receipt, signatureValid: verifyReceipt(receipt) }) : { status: 404, body: { error: "No receipt with that id or transaction hash in this journal." } };
      }
      case "receipt.create": {
        const invalid = assertQuotable(payload?.quote);
        if (invalid) return bad(invalid);
        const s = payload.settlement;
        if (!s || !hash(s.txHash) || !timestamp(s.settledAt) || !amount(s.sellAmount) || !amount(s.buyAmount)) {
          return bad("Settlement needs txHash, settledAt and both amounts. They come from the fill you observed, not from the quote.");
        }
        if (s.rateRay !== undefined && !amount(s.rateRay)) return bad("settlement.rateRay must be a decimal integer string.");
        if (s.route !== undefined && !Array.isArray(s.route)) return bad("settlement.route must be a list.");
        const limit = payload.slippageBpsLimit ?? 100;
        if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0 || limit > 10_000) return bad("slippageBpsLimit must be between 0 and 10000.");
        const receipt = makeReceipt({ quote: asQuote(payload.quote), settlement: s, slippageBpsLimit: limit }, signingKey());
        const store = await journal();
        store.put(receipt);
        return { status: 201, body: { receipt, signatureValid: verifyReceipt(receipt), persistence: store.persistence } };
      }
      case "receipt.verify": {
        const receipt = payload as Receipt;
        if (!receipt?.signature?.value || !receipt?.signature?.publicKey) return bad("Paste a complete receipt object.");
        return ok({ valid: verifyReceipt(receipt), comparison: receipt.comparison, id: receipt.id, txHash: receipt.txHash });
      }
      default:
        return { status: 404, body: { error: "Unknown action." } };
    }
  } catch (e) {
    const message = (e as Error)?.message || "Request failed.";
    // Upstream text is operator-facing; never echo a raw key fragment.
    if (/TEXTILE_API_KEY|corridor|Textile API/i.test(message)) return upstream(message.slice(0, 400));
    return bad(message.slice(0, 400));
  }
}
