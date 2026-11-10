import './style.css';

/**
 * CorridorProof workbench. Values from the API or from a visitor are written through
 * textContent only, so a hostile quote payload cannot become markup.
 */

const CHAIN_ID = 42220;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const INTEGER = /^(0|[1-9][0-9]{0,38})$/;

/**
 * Token metadata and enabled corridors, copied from the Textile FX address book for
 * Celo (chain 42220). Nothing here is invented: an unlisted pair is not offered.
 */
const TOKENS = {
  cNGN: { address: '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f', decimals: 6 },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  wARS: { address: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D', decimals: 18 },
  wBRL: { address: '0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0', decimals: 18 },
  wCOP: { address: '0x8a1D45e102e886510e891d2Ec656a708991e2D76', decimals: 18 },
  wMXN: { address: '0x337E7456B420bD3481e7FA61fA9850343d610d34', decimals: 18 },
  IDRX: { address: '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', decimals: 2 },
  CELO: { address: '0x471EcE3750Da237f93B8E339c536989b8978a438', decimals: 18 },
  WETH: { address: '0xD221812de1BD094f35587EE8E174B07B6167D9Af', decimals: 18 },
  USAT: { address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', decimals: 6 },
  GD: { address: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', decimals: 18 },
} as const;

type Symbol = keyof typeof TOKENS;
type Json = Record<string, unknown>;
type Comparison = { verified: boolean; flags: string[]; slippageBps: number; slippageLimitBps: number; rateDeltaBps: number | null; expiryHonored: boolean; routeMatched: boolean };
type Receipt = { id: string; createdAt: string; txHash: string; rfqId: string; comparison: Comparison; provenance: { source: string; tagVerified: boolean }; signature: { publicKey: string; payloadHash: string; algorithm: string; value: string } };

const PAIRS: Array<[Symbol, Symbol]> = [
  ['cNGN', 'USDT'], ['USDT', 'cNGN'],
  ['USDC', 'USDT'], ['USDT', 'USDC'],
  ['wARS', 'USDT'], ['USDT', 'wARS'],
  ['wBRL', 'USDT'], ['USDT', 'wBRL'],
  ['wCOP', 'USDT'], ['USDT', 'wCOP'],
  ['wMXN', 'USDT'], ['USDT', 'wMXN'],
  ['IDRX', 'USDT'], ['USDT', 'IDRX'],
  ['CELO', 'USDT'], ['USDT', 'CELO'],
  ['WETH', 'USDT'], ['USDT', 'WETH'],
  ['USAT', 'USDT'], ['USDT', 'USAT'],
  ['GD', 'USDT'], ['USDT', 'GD'],
  ['cNGN', 'GD'], ['GD', 'cNGN'],
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const field = (id: string): Field => {
  const node = document.getElementById(id);
  if (!node || !('value' in node)) throw new Error('Missing form field: ' + id);
  return node as Field;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const show = (slot: HTMLElement, ...nodes: Node[]) => {
  slot.replaceChildren(...nodes);
  slot.hidden = false;
  slot.classList.remove('err');
  return slot;
};
const fail = (slot: HTMLElement, message: string) => { show(slot, el('p', message)); slot.classList.add('err'); };
const pending = (slot: HTMLElement) => {
  const wrap = el('div', undefined, 'skeleton');
  wrap.append(el('i'), el('i'), el('i'));
  return show(slot, wrap);
};
const busy = (button: HTMLButtonElement, label: string, work: () => Promise<void>) => {
  const original = button.textContent ?? '';
  button.disabled = true;
  button.textContent = label;
  void work().finally(() => { button.disabled = false; button.textContent = original; });
};

function readout(pairs: Array<[string, string]>) {
  const dl = el('dl', undefined, 'read');
  for (const [label, value] of pairs) {
    const cell = el('div');
    cell.append(el('dt', label), el('dd', value));
    dl.append(cell);
  }
  return dl;
}

function stamp(ok: boolean, label: string) {
  const s = el('span', undefined, `stamp ${ok ? 'good' : 'bad'}`);
  s.append(el('i'), el('span', label));
  return s;
}

function externalLink(text: string, href: string) {
  const a = el('a', text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function toBase(whole: string, decimals: number) {
  if (!/^\d+(\.\d+)?$/.test(whole)) return null;
  const [int, frac = ''] = whole.split('.');
  if (frac.length > decimals) return null;
  const value = BigInt(int) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return value > 0n ? value.toString() : null;
}

function formatUnits(base: string, decimals: number) {
  if (!INTEGER.test(base)) return base;
  const digits = base.padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals) || '0';
  const frac = digits.slice(-decimals).replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? '.' + frac : ''}`;
}

/** rateRay is 1e27 fixed point; six significant digits keeps small cross-rates readable. */
function rateFromRay(ray: string) {
  if (!INTEGER.test(ray)) return ray;
  const scaled = Number(BigInt(ray) / 10n ** 18n) / 1e9;
  if (!Number.isFinite(scaled) || scaled === 0) return ray;
  return scaled >= 0.001 ? scaled.toPrecision(6) : scaled.toExponential(4);
}

async function call<T = Json>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? { headers: { accept: 'application/json' } }
    : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  let data: Json;
  try { data = JSON.parse(text); } catch { throw new Error(`${path} replied with something that is not JSON.`); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`);
  return data as T;
}

/** Indicative previews nest under data; firm quotes nest under quote. Try both. */
function quoteFields(source: Json) {
  const nest = (o: unknown): Json | null => {
    if (!o || typeof o !== 'object') return null;
    const rec = o as Json;
    if (typeof rec.sellAmount === 'string' && typeof rec.buyAmount === 'string') return rec;
    for (const key of ['quote', 'data', 'result', 'rfq']) {
      const found = nest(rec[key]);
      if (found) return found;
    }
    return null;
  };
  const leg = nest(source);
  const swap = (((source.transactions as Json | undefined)?.swap) as Json | undefined) ?? undefined;
  return {
    sell: leg?.sellAmount as string | undefined,
    buy: leg?.buyAmount as string | undefined,
    rateRay: leg?.rateRay as string | undefined,
    feeAmount: leg?.feeAmount as string | undefined,
    available: leg?.availableSellAmount as string | undefined,
    expiresAt: leg?.expiresAt as string | undefined,
    rfqId: typeof source.rfqId === 'string' ? source.rfqId : undefined,
    swap,
  };
}

function setChip(id: string, text: string, state: 'live' | 'off' | '') {
  const chip = $(id);
  chip.textContent = text;
  if (state) chip.dataset.state = state; else delete chip.dataset.state;
}

const isoToLocalInput = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString().slice(0, 16));
const localInputToIso = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};
const defaultExpiry = () => new Date(Date.now() + 20 * 60_000).toISOString().slice(0, 16);

let midRay: string | null = null;
let lastQuote: Json | null = null;
// Hosted journals are per-instance, so receipts this tab issued are kept here and
// merged into the journal view; otherwise a reload-balanced instance would hide them.
const sessionReceipts: Receipt[] = [];

function selectedPair(): [Symbol, Symbol] {
  return PAIRS[Number(field('p-corridor').value)] ?? PAIRS[0];
}

function populateCorridors() {
  const select = $('p-corridor') as HTMLSelectElement;
  PAIRS.forEach((pair, index) => {
    const option = el('option', `${pair[0]} → ${pair[1]}`);
    option.value = String(index);
    select.append(option);
  });
}

async function loadHealth() {
  try {
    const health = await call<Json>('/api/health');
    setChip('s-network', `Celo ${String(health.chainId)}`, 'live');
    setChip('s-rfq', health.rfq === 'enabled' ? 'firm quotes armed' : 'preview only', health.rfq === 'enabled' ? 'live' : '');
    setChip('s-settle', health.settlement === 'armed' ? 'wallet armed' : 'not armed', health.settlement === 'armed' ? '' : 'off');
    setChip('s-tag', String(health.attributionTag ?? '—'), health.attributionCredited ? 'live' : 'off');
  } catch (e) {
    setChip('s-network', 'service unreachable', 'off');
    fail($('preview-out'), (e as Error).message);
  }
}

function renderMetrics(receipts: Receipt[]) {
  const verified = receipts.filter((r) => r.comparison.verified).length;
  const chain = receipts.filter((r) => r.provenance?.source === 'chain').length;
  const drift = receipts.map((r) => r.comparison.rateDeltaBps).filter((v): v is number => v !== null);
  const mean = drift.length ? Math.round((drift.reduce((a, b) => a + b, 0) / drift.length) * 100) / 100 : null;
  show($('metrics'), readout([
    ['Receipts issued', String(receipts.length)],
    ['Verified', String(verified)],
    ['Flagged', String(receipts.length - verified)],
    ['Amounts read from chain', `${chain} of ${receipts.length}`],
    ['Mean rate drift', mean === null ? '—' : `${mean} bps`],
    ['Slippage breaches', String(receipts.filter((r) => r.comparison.flags.includes('slippage-exceeded')).length)],
  ]));
}

function wirePreview() {
  $('preview-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('preview-out');
    const [sell, buy] = selectedPair();
    const sellToken = TOKENS[sell], buyToken = TOKENS[buy];
    const sellAmount = toBase(field('p-amount').value.trim(), sellToken.decimals);
    if (!sellAmount) return fail(slot, `Enter an amount above zero with at most ${sellToken.decimals} decimal places.`);

    busy($('p-go') as HTMLButtonElement, 'Asking Textile…', async () => {
      pending(slot);
      try {
        const data = await call<Json>('/api/quote/preview', { chainId: CHAIN_ID, sellToken: sellToken.address, buyToken: buyToken.address, sellAmount });
        const found = quoteFields(data);
        if (!found.rateRay) {
          const upstream = (data.data as Json | undefined)?.status;
          return fail(slot, upstream === 'no_quote'
            ? 'No makers are quoting this corridor right now. Choose another corridor and try again.'
            : 'Textile answered without a rate, so there is nothing to price against.');
        }
        midRay = found.rateRay;
        show(slot,
          stamp(true, 'CORRIDOR LIVE'),
          readout([
            ['Quoted rate', `${rateFromRay(found.rateRay)} ${buy} per ${sell}`],
            ['You sell', `${formatUnits(sellAmount, sellToken.decimals)} ${sell}`],
            ['You receive', found.buy ? `${formatUnits(found.buy, buyToken.decimals)} ${buy}` : 'not returned'],
            ['Network fee', found.feeAmount ? `${formatUnits(found.feeAmount, buyToken.decimals)} ${buy}` : 'not returned'],
            ['Quoted depth', found.available ? `${formatUnits(found.available, sellToken.decimals)} ${sell}` : 'not returned'],
          ]),
          el('p', 'Indicative pricing from Textile makers. A firm quote is what binds the number and the window.'),
        );
        if (found.sell && found.buy) {
          const carry = el('button', 'Carry into step 4', 'ghost');
          carry.addEventListener('click', () => {
            field('q-out').value = found.sell!;
            field('q-in').value = found.buy!;
            field('q-exp').value = found.expiresAt ? isoToLocalInput(found.expiresAt) : defaultExpiry();
            $('pricing-out').hidden = false;
            carry.replaceWith(stamp(true, 'CARRIED INTO STEP 4'));
          });
          slot.append(el('div', undefined, 'row'), carry);
        }
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
}

function wirePricing() {
  $('pricing-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('pricing-out');
    if (!midRay) return fail(slot, 'Run step 1 first — the book is priced against the mid Textile just quoted.');
    const mid = midRay;
    const [sell] = selectedPair();
    busy($('d-go') as HTMLButtonElement, 'Pricing…', async () => {
      pending(slot);
      try {
        const result = await call<Json>('/api/pricing/quote', {
          midRay,
          size: field('d-size').value.trim() || '1',
          spreadBps: Number(field('d-spread').value),
          skewBpsPerFullScale: Number(field('d-skew').value),
          inventoryBase: field('d-inventory-base').value.trim() || '0',
          inventoryQuote: field('d-inventory-quote').value.trim() || '0',
        });
        const quotes = Array.isArray(result.quotes) ? result.quotes as Json[] : [];
        const book = readout(quotes.map((q) => [
          q.side === 'sell' ? 'Desk sells base at' : 'Desk buys base at',
          `${rateFromRay(String(q.priceRay))}${q.accepted ? '' : ' (no capacity)'}`,
        ]));
        const traces = el('ul', undefined, 'checks');
        for (const q of quotes) for (const line of (q.trace as string[]) ?? []) traces.append(el('li', `${q.side}: ${line}`, q.accepted ? 'pass' : 'fail'));
        show(slot, stamp(quotes.every((q) => q.accepted), quotes.every((q) => q.accepted) ? 'BOOK QUOTED' : 'BOOK PARTIALLY QUOTED'), book, traces,
          el('p', `Priced from a ${sell} mid of ${rateFromRay(mid)}. This book is not yet answering Textile RFQ solicitations — it shows the decision, not a live maker feed.`));
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
}

function wireFirm() {
  $('firm-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('firm-out');
    const taker = field('f-taker').value.trim();
    if (!ADDRESS.test(taker)) return fail(slot, 'The taker must be a wallet address that will sign the swap.');
    const [sell, buy] = selectedPair();
    const amount = toBase(field('p-amount').value.trim(), TOKENS[sell].decimals);
    if (!amount) return fail(slot, `Enter an amount above zero with at most ${TOKENS[sell].decimals} decimal places.`);
    const side = field('f-side').value;

    busy($('f-go') as HTMLButtonElement, 'Requesting…', async () => {
      pending(slot);
      try {
        const data = await call<Json>('/api/quote/firm', {
          chainId: CHAIN_ID, sellToken: TOKENS[sell].address, buyToken: TOKENS[buy].address, [side]: amount, taker,
        });
        lastQuote = data;
        const found = quoteFields(data);
        show(slot,
          stamp(true, 'FIRM QUOTE'),
          readout([
            ['RFQ id', found.rfqId ?? 'not returned'],
            ['Quoted out', found.sell ?? '—'],
            ['Quoted in', found.buy ?? '—'],
            ['Binding until', found.expiresAt ?? '—'],
            ['Settlement nonce', String(data.settleNonce ?? 'not returned')],
            ['Executable', found.swap?.to ? `calldata for ${String(found.swap.to).slice(0, 10)}…${String(found.swap.to).slice(-6)}` : 'no swap calldata returned'],
          ]),
        );
        const actions = el('div', undefined, 'row');
        if (found.sell && found.buy) {
          const carry = el('button', 'Carry into step 4', 'ghost');
          carry.addEventListener('click', () => {
            field('q-out').value = found.sell!; field('q-in').value = found.buy!;
            field('q-exp').value = found.expiresAt ? isoToLocalInput(found.expiresAt) : defaultExpiry();
            carry.replaceWith(stamp(true, 'CARRIED'));
          });
          actions.append(carry);
        }
        if (data.settleNonce) {
          const envelope = el('button', 'Build settlement envelope', 'ghost');
          envelope.addEventListener('click', () => {
            const out = $('receipt-out');
            busy(envelope, 'Building…', async () => {
              try {
                const dry = await call<Json>('/api/settle/dry-run', { quote: data });
                const calldata = String(dry.data ?? '');
                show(out, stamp(true, 'ENVELOPE READY'), readout([
                  ['Target', String(dry.to ?? '—')],
                  ['Value', String(dry.value ?? '0')],
                  ['Calldata', `${Math.max(0, calldata.length / 2 - 1)} bytes, ending with the attribution suffix`],
                  ['Suffix', calldata.slice(-70)],
                  ['Broadcast', dry.mode === 'dry-run' ? 'not sent — this deployment holds no wallet' : 'sent from the agent wallet'],
                ]));
              } catch (e) { fail(out, (e as Error).message); }
            });
          });
          actions.append(envelope);
        }
        slot.append(actions);
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
}

function receiptView(slot: HTMLElement, receipt: Receipt, signatureValid: boolean, note?: string) {
  const c = receipt.comparison;
  const checks = el('ul', undefined, 'checks');
  const item = (pass: boolean, text: string) => checks.append(el('li', text, pass ? 'pass' : 'fail'));
  item(c.expiryHonored, c.expiryHonored ? 'Settled inside the quote window' : 'Settled after the quote expired');
  item(c.routeMatched, c.routeMatched ? 'Fill route matches the quoted route' : 'Fill route differs from the quoted route');
  item(c.slippageBps <= c.slippageLimitBps, `Adverse slippage ${c.slippageBps} bps against a ${c.slippageLimitBps} bps limit`);
  item(signatureValid, signatureValid ? 'Signature and payload hash check out' : 'Signature does not match this payload');
  const chainSourced = receipt.provenance?.source === 'chain';
  item(chainSourced, chainSourced ? 'Fill amounts read from chain logs' : 'Fill amounts recorded by hand');

  const nodes: Node[] = [
    stamp(c.verified && signatureValid, c.verified && signatureValid ? 'VERIFIED' : 'FLAGGED'),
    readout([
      ['Receipt', receipt.id],
      ['Transaction', receipt.txHash],
      ['Amounts from', chainSourced ? 'chain transfer logs' : 'manual record'],
      ['Rate drift', c.rateDeltaBps === null ? '—' : `${c.rateDeltaBps} bps`],
      ['Flags', c.flags.length ? c.flags.join(', ') : 'none'],
      ['Payload hash', receipt.signature.payloadHash],
      ['Signature', `${receipt.signature.algorithm} ${receipt.signature.value.slice(0, 40)}…`],
    ]),
    checks,
  ];
  if (note) nodes.push(el('p', note));

  const actions = el('div', undefined, 'row');
  const copy = el('button', 'Copy receipt', 'ghost');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(receipt)); copy.replaceWith(stamp(true, 'COPIED')); }
    catch { fail(slot, 'Your browser blocked the clipboard. Download the receipt instead.'); }
  });
  const download = el('a', 'Download receipt');
  download.href = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  download.download = `corridorproof-${receipt.id.slice(0, 8)}.json`;
  actions.append(copy, download);
  if (HASH.test(receipt.txHash)) actions.append(externalLink('Open transaction', `https://celoscan.io/tx/${receipt.txHash}`));
  nodes.push(actions);
  return show(slot, ...nodes);
}

function syncFillSource() {
  const chain = field('s-mode').value === 'chain';
  document.querySelectorAll<HTMLElement>('.chain-only').forEach((node) => { node.hidden = !chain; });
  document.querySelectorAll<HTMLElement>('.declared-only').forEach((node) => { node.hidden = chain; });
  $('taker-row').hidden = !chain;
}

function wireLedger() {
  field('q-exp').value = defaultExpiry();
  field('r-at').value = defaultExpiry();
  field('s-mode').addEventListener('change', syncFillSource);
  syncFillSource();

  $('ledger-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('receipt-out');
    const chain = field('s-mode').value === 'chain';
    const qOut = field('q-out').value.trim(), qIn = field('q-in').value.trim();
    const expiresAt = localInputToIso(field('q-exp').value);
    const tx = field('r-tx').value.trim();
    const limit = Number(field('r-limit').value);

    if (!INTEGER.test(qOut) || !INTEGER.test(qIn) || qOut === '0' || qIn === '0') return fail(slot, 'Quoted out and quoted in must be whole base-unit amounts above zero. Run step 1 and carry them in.');
    if (!expiresAt) return fail(slot, 'Give the quote expiry.');
    if (!HASH.test(tx)) return fail(slot, 'Settlement hash is a 66-character transaction id.');
    if (!Number.isFinite(limit) || limit < 0 || limit > 10000) return fail(slot, 'Slippage limit is in basis points, between 0 and 10000.');

    const quoteBody = {
      rfqId: lastQuote ? String(quoteFields(lastQuote).rfqId ?? 'recorded') : 'recorded',
      status: 'recorded', chainId: CHAIN_ID,
      quote: { sellAmount: qOut, buyAmount: qIn, expiresAt },
    };

    busy($('r-go') as HTMLButtonElement, chain ? 'Reading chain…' : 'Signing…', async () => {
      pending(slot);
      try {
        let body: Json;
        if (chain) {
          const taker = field('s-taker').value.trim();
          if (!ADDRESS.test(taker)) throw new Error('The taker address is the wallet that received the fill.');
          const [sell, buy] = selectedPair();
          body = {
            quote: quoteBody,
            observe: { txHash: tx, taker, sellToken: TOKENS[sell].address, buyToken: TOKENS[buy].address },
            slippageBpsLimit: limit,
          };
        } else {
          const fOut = field('f-out-manual').value.trim(), fIn = field('f-in-manual').value.trim();
          const settledAt = localInputToIso(field('r-at').value);
          if (!INTEGER.test(fOut) || !INTEGER.test(fIn)) throw new Error('Filled out and filled in must be whole base-unit amounts.');
          if (!settledAt) throw new Error('Give the settlement time.');
          body = {
            quote: quoteBody,
            settlement: { txHash: tx, settledAt, sellAmount: fOut, buyAmount: fIn },
            slippageBpsLimit: limit,
          };
        }
        const result = await call<{ receipt: Receipt; signatureValid: boolean; persistence: string }>('/api/receipts', body);
        sessionReceipts.unshift(result.receipt);
        const hosted = result.persistence === 'jsonl';
        receiptView(slot, result.receipt, result.signatureValid, hosted
          ? 'Signed here and kept on this request instance only. Download it to keep the record; a self-hosted journal persists to SQLite.'
          : undefined);
        void loadJournal();
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
}

function wireTag() {
  $('tag-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('tag-out');
    const txHash = field('t-tx').value.trim();
    if (!HASH.test(txHash)) return fail(slot, 'Paste a full 66-character transaction hash.');
    busy($('t-go') as HTMLButtonElement, 'Reading chain…', async () => {
      pending(slot);
      try {
        const proof = await call<Json>('/api/attribution/read', { txHash });
        const codes = Array.isArray(proof.codes) ? proof.codes.map(String) : [];
        show(slot,
          stamp(Boolean(proof.creditedToEnrollment), codes.length ? `TAGGED: ${codes.join(', ')}` : 'NO ATTRIBUTION TAG'),
          readout([['Transaction', txHash], ['Schema', String(proof.schemaId ?? '—')], ['Enrollment code here', String(proof.configured ?? '—')]]),
          el('p', codes.length ? 'Read from the chain itself, not from this service’s records.' : 'This transaction carries no ERC-8021 suffix.'),
        );
        const row = el('div', undefined, 'row');
        row.append(externalLink('Open on Celoscan', `https://celoscan.io/tx/${txHash}`));
        slot.append(row);
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
}

function wireVerify() {
  $('verify-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('verify-out');
    let parsed: unknown;
    try { parsed = JSON.parse(field('v-json').value); } catch { return fail(slot, 'That is not readable JSON.'); }
    busy($('v-go') as HTMLButtonElement, 'Checking…', async () => {
      pending(slot);
      try {
        const result = await call<{ valid: boolean; comparison: Comparison; id: string; txHash: string }>('/api/receipts/verify', parsed);
        show(slot,
          stamp(result.valid, result.valid ? 'SIGNATURE VALID' : 'SIGNATURE INVALID'),
          readout([['Receipt', result.id], ['Transaction', result.txHash], ['Record claims', result.comparison.verified ? 'every check passed' : 'checks were flagged']]),
          el('p', 'Verified against the key embedded in the receipt. Anyone, anywhere can repeat this.'),
        );
      } catch (e) { fail(slot, (e as Error).message); }
    });
  });
  $('v-load').addEventListener('click', () => {
    const entry = document.querySelector<HTMLElement>('#journal .entry');
    if (!entry?.dataset.receipt) return fail($('verify-out'), 'Nothing issued in this journal yet. Issue a receipt in step 4 first.');
    field('v-json').value = entry.dataset.receipt;
    ($('v-go') as HTMLButtonElement).click();
  });
}

async function loadJournal() {
  const slot = $('journal');
  try {
    const data = await call<{ receipts: Receipt[]; persistence: string }>('/api/receipts');
    const receipts = [...sessionReceipts, ...data.receipts.filter((r) => !sessionReceipts.some((s) => s.id === r.id))];
    renderMetrics(receipts);
    $('journal-note').textContent = data.persistence === 'jsonl'
      ? 'Receipts issued on this instance, newest first. Hosted instances keep them only while the container lives.'
      : 'Receipts in this deployment’s journal, newest first.';
    if (!receipts.length) return show(slot, el('p', 'No receipts issued here yet. Step 4 produces the first one.', 'empty'));
    slot.replaceChildren(...receipts.map((r) => {
      const row = el('div', undefined, 'entry');
      row.dataset.receipt = JSON.stringify(r);
      row.append(
        el('b', `${r.comparison.verified ? 'VERIFIED' : 'FLAGGED'} · ${r.id.slice(0, 8)}`),
        el('span', r.txHash),
        el('span', `${r.provenance?.source === 'chain' ? 'chain-read' : 'hand-recorded'} · ${new Date(r.createdAt).toISOString()}`),
      );
      const open = el('button', 'Verify this one', 'ghost');
      open.addEventListener('click', () => {
        field('v-json').value = row.dataset.receipt ?? '';
        ($('v-go') as HTMLButtonElement).click();
        $('verify-out').scrollIntoView({ block: 'center' });
      });
      row.append(open);
      return row;
    }));
    slot.hidden = false;
  } catch (e) {
    $('journal-note').textContent = 'Journal unavailable.';
    fail(slot, (e as Error).message);
  }
}

populateCorridors();
wirePreview();
wirePricing();
wireFirm();
wireLedger();
wireTag();
wireVerify();
void loadHealth();
void loadJournal();
