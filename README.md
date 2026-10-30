# CorridorProof

CorridorProof captures a firm Textile FX quote, records the Celo settlement, and signs a portable quote-versus-fill receipt. It is an audit layer, not a swap app. Built for agents on open rails.

## Quickstart

Requirements: Node.js 20+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. Receipt records live locally in `.data/receipts.sqlite` and `.data/receipts.jsonl`; the first run creates an Ed25519 signing key in `.data/receipt-ed25519.pem`. Keep both private files out of source control and back them up if you need to verify future receipts.

Run checks with `npm test` and `npm run build`.

## RFQ flow

The integration uses Textile FX v2 at `https://api.textilecredit.com/v2`: `POST /rfq/preview` for indicative pricing and `POST /rfq/request` for firm quotes. Firm requests require `chainId`, `sellToken`, `buyToken`, exactly one of `sellAmount` or `buyAmount`, and `taker`. Set `TEXTILE_API_KEY` for keyed requests. A keyless request must provide the Textile TakerControl proof; the current server intentionally refuses the keyless path until the deployment has configured that proof safely. Firm quote responses include `quote.expiresAt` and `transactions.swap`; the swap transaction is the executable aggregate calldata, including bundled maker orders. Receipt `rfqId`, claim token, and Textile settlement status are not persisted by this initial UI flow; retain them externally if you need to submit or query RFQ lifecycle state.

## Settlement and attribution

Settlement uses viem on Celo mainnet (chain id `42220`, default RPC `https://forno.celo.org`). With no `AGENT_PRIVATE_KEY`, `/api/settle` returns a dry-run transaction envelope and does not broadcast. To enable broadcast, set `AGENT_PRIVATE_KEY` only in a private environment. The executor rejects other chain IDs and expired quotes.

Every swap's calldata is suffixed with Celo's ERC-8021 attribution encoding via `@celo/attribution-tags`. `LOOPS_ATTRIBUTION_TAG` defaults to the conspicuously unassigned `corridorproof_placeholder`. Enroll at Loops House and set the issued code before sending any transaction you expect to be credited. Placeholder activity is not credited to your enrollment, and tags cannot be backfilled. Replace it with the exact issued code; do not derive a substitute.

Approvals are intentionally not executed by the current executor. Check Textile's approval transaction and allowance before live swap use; a quote that needs approval must be handled separately without crossing `expiresAt`.

## Receipts

Receipts compare quoted and settled amounts/rate, maker route, adverse slippage against a configurable basis-point limit, and settlement timestamp against the firm quote expiry. Each payload is signed with Ed25519 and includes its public key and SHA-256 payload hash for independent verification. The built-in store supports local SQLite lookup/list and JSONL append-only export. `POST /api/receipts/verify` verifies a receipt signature; it does not independently fetch Celo logs or Textile state, so the settlement observation passed to the receipt engine must itself be trusted or verified by a caller.

## ERC-8004 identity preparation

`npm run erc8004:prepare` writes an unsigned `register(string agentURI)` transaction for the Celo Identity Registry (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) into `.data/erc8004-registration.json`. Set `AGENT_ADDRESS` and optionally `AGENT_URI`. It never signs or broadcasts. Review and publish the required registration JSON and use the funded agent wallet to execute the prepared transaction separately.

## Configuration

See `.env.example`. Never commit keys, receipt-store files, or registration metadata containing secrets.

## Security boundaries

This repository does not make a live trade, publish agent identity metadata, custody keys, or assert that a settlement is final merely because a quote was returned. The caller remains responsible for wallet funding, token allowances, correct token/corridor validation, and independently confirming transaction details.
