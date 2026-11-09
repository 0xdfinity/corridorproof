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

const label = (pair: [Symbol, Symbol]) => `${pair[0]} → ${pair[1]}`;

type Json = Record<string, unknown>;
type Comparison = { verified: boolean; flags: string[]; slippageBps: number; slippageLimitBps: number; rateDeltaBps: number | null; expiryHonored: boolean; routeMatched: boolean };
type Receipt = { id: string; createdAt: string; txHash: string; rfqId: string; comparison: Comparison; signature: { publicKey: string; payloadHash: string; algorithm: string; value: string } };

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

function externalLink(label: string, href: string) {
  const a = el('a', label);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

/** Whole tokens to base units, without float arithmetic. */
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

/**
 * Reads the amounts out of a Textile response. Preference order is explicit, because
 * an indicative preview and a firm quote nest their numbers differently.
 */
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
  const expiresAt = leg && typeof leg.expiresAt === 'string' ? leg.expiresAt : undefined;
  const swap = (((source.transactions as Json | undefined)?.swap) as Json | undefined) ?? undefined;
  return {
    sell: leg?.sellAmount as string | undefined,
    buy: leg?.buyAmount as string | undefined,
    rateRay: leg?.rateRay as string | undefined,
    expiresAt,
    rfqId: typeof source.rfqId === 'string' ? source.rfqId : undefined,
    swap,
  };
}

function setChip(id: string, text: string, state: 'live' | 'off' | '') {
  const chip = $(id);
  chip.textContent = text;
  if (state) chip.dataset.state = state; else delete chip.dataset.state;
}

let health: Json = {};
let lastQuote: Json | null = null;

async function loadHealth() {
  try {
    health = await call<Json>('/api/health');
    setChip('s-network', `Celo ${String(health.chainId)}`, 'live');
    setChip('s-rfq', health.rfq === 'enabled' ? 'firm quotes armed' : 'preview only', health.rfq === 'enabled' ? 'live' : '');
    setChip('s-settle', health.settlement === 'enabled' ? 'wallet armed' : 'dry-run only', health.settlement === 'enabled' ? '' : 'off');
    setChip('s-tag', String(health.attributionTag ?? '—'), health.attributionCredited ? 'live' : 'off');
  } catch (e) {
    setChip('s-network', 'service unreachable', 'off');
    fail($('preview-out'), (e as Error).message);
  }
}

const isoToLocalInput = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString().slice(0, 16));
const localInputToIso = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};
const defaultExpiry = () => new Date(Date.now() + 20 * 60_000).toISOString().slice(0, 16);

/** Fills the record panel from a quote so nobody retypes base-unit integers by hand. */
function carryIntoLedger(quoted: { sell: string; buy: string; expiresAt?: string }, target: HTMLElement) {
  field('q-out').value = quoted.sell;
  field('q-in').value = quoted.buy;
  field('q-exp').value = quoted.expiresAt ? isoToLocalInput(quoted.expiresAt) : defaultExpiry();
  field('f-out').value = quoted.sell;
  target.replaceChildren(stamp(true, 'CARRIED INTO STEP 3'));
}

/**
 * rateRay is an 1e27 fixed-point price. Rates here span four orders of magnitude,
 * so six significant digits are kept rather than a fixed number of decimals.
 */
function rateFromRay(ray: string) {
  if (!INTEGER.test(ray)) return ray;
  const scaled = Number(BigInt(ray) / 10n ** 18n) / 1e9;
  if (!Number.isFinite(scaled) || scaled === 0) return ray;
  return scaled >= 0.001 ? scaled.toPrecision(6) : scaled.toExponential(4);
}

function selectedPair(): [Symbol, Symbol] {
  return PAIRS[Number(field('p-corridor').value)] ?? PAIRS[0];
}

function populateCorridors() {
  const select = $('p-corridor') as HTMLSelectElement;
  PAIRS.forEach((pair, index) => {
    const option = el('option', label(pair));
    option.value = String(index);
    select.append(option);
  });
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
        const available = typeof (data.data as Json | undefined)?.availableSellAmount === 'string'
          ? formatUnits(String((data.data as Json).availableSellAmount), sellToken.decimals)
          : '—';
        show(slot,
          stamp(true, 'CORRIDOR LIVE'),
          readout([
            ['Quoted rate', found.rateRay ? `${rateFromRay(found.rateRay)} ${buy} per ${sell}` : 'rate not returned'],
            ['You sell', `${formatUnits(sellAmount, sellToken.decimals)} ${sell}`],
            ['You receive', found.buy ? formatUnits(found.buy, buyToken.decimals) + ' ' + buy : 'not returned'],
            ['Network fee', typeof (data.data as Json | undefined)?.feeAmount === 'string' ? formatUnits(String((data.data as Json).feeAmount), buyToken.decimals) + ' ' + buy : 'not returned'],
            ['Quoted depth', available === '—' ? '—' : `${available} ${sell} available at this price`],
          ]),
          el('p', 'Indicative pricing from Textile makers. A firm quote is what binds the number and the window.'),
        );
        if (found.sell && found.buy) {
          const carry = el('button', 'Carry into step 3', 'ghost');
          carry.addEventListener('click', () => carryIntoLedger({ sell: found.sell!, buy: found.buy!, expiresAt: found.expiresAt }, carry));
          slot.append(el('div', undefined, 'row'), carry);
        }
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
    const sellToken = TOKENS[sell].address, buyToken = TOKENS[buy].address;
    const amount = toBase(field('p-amount').value.trim(), TOKENS[sell].decimals);
    if (!amount) return fail(slot, `Enter an amount above zero with at most ${TOKENS[sell].decimals} decimal places.`);
    const side = field('f-side').value;

    busy($('f-go') as HTMLButtonElement, 'Requesting…', async () => {
      pending(slot);
      try {
        const data = await call<Json>('/api/quote/firm', { chainId: CHAIN_ID, sellToken, buyToken, [side]: amount, taker });
        lastQuote = data;
        const found = quoteFields(data);
        show(slot,
          stamp(true, 'FIRM QUOTE'),
          readout([
            ['RFQ id', found.rfqId ?? 'not returned'],
            ['Quoted out', found.sell ?? '—'],
            ['Quoted in', found.buy ?? '—'],
            ['Binding until', found.expiresAt ?? '—'],
            ['Executable', found.swap?.to ? `calldata for ${String(found.swap.to).slice(0, 10)}…${String(found.swap.to).slice(-6)}` : 'no swap calldata returned'],
          ]),
        );
        const actions = el('div', undefined, 'row');
        if (found.sell && found.buy) {
          const carry = el('button', 'Carry into step 3', 'ghost');
          carry.addEventListener('click', () => carryIntoLedger({ sell: found.sell!, buy: found.buy!, expiresAt: found.expiresAt }, carry));
          actions.append(carry);
        }
        if (found.swap) {
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
                  ['Broadcast', dry.mode === 'dry-run' ? 'not sent — this deployment holds no wallet key' : 'sent from the agent wallet'],
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

  const nodes: Node[] = [
    stamp(c.verified && signatureValid, c.verified && signatureValid ? 'VERIFIED' : 'FLAGGED'),
    readout([
      ['Receipt', receipt.id],
      ['Transaction', receipt.txHash],
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

function wireLedger() {
  field('q-exp').value = defaultExpiry();
  field('r-at').value = defaultExpiry();
  $('receipt-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = $('receipt-out');
    const fields = {
      qOut: field('q-out').value.trim(), qIn: field('q-in').value.trim(),
      fOut: field('f-out').value.trim(), fIn: field('f-in').value.trim(),
      tx: field('r-tx').value.trim(), limit: Number(field('r-limit').value),
    };
    for (const [name, value] of Object.entries({ 'quoted out': fields.qOut, 'quoted in': fields.qIn, 'filled out': fields.fOut, 'filled in': fields.fIn })) {
      if (!INTEGER.test(value) || value === '0') return fail(slot, `${name} must be a whole number of base units greater than zero.`);
    }
    if (!HASH.test(fields.tx)) return fail(slot, 'Settlement hash is a 66-character transaction id.');
    const expiresAt = localInputToIso(field('q-exp').value), settledAt = localInputToIso(field('r-at').value);
    if (!expiresAt || !settledAt) return fail(slot, 'Give both the quote expiry and the settlement time.');
    if (!Number.isFinite(fields.limit) || fields.limit < 0 || fields.limit > 10000) return fail(slot, 'Slippage limit is in basis points, between 0 and 10000.');

    busy($('r-go') as HTMLButtonElement, 'Signing…', async () => {
      pending(slot);
      try {
        const route = field('r-route').value.split(',').map((s) => s.trim()).filter(Boolean);
        const body = {
          quote: {
            rfqId: lastQuote ? String(quoteFields(lastQuote).rfqId ?? 'recorded') : 'recorded',
            status: 'recorded',
            chainId: CHAIN_ID,
            quote: { sellAmount: fields.qOut, buyAmount: fields.qIn, expiresAt, ...(route.length ? { orders: route.map((maker) => ({ maker })) } : {}) },
          },
          settlement: { txHash: fields.tx, settledAt, sellAmount: fields.fOut, buyAmount: fields.fIn, ...(route.length ? { route } : {}) },
          slippageBpsLimit: fields.limit,
        };
        const result = await call<{ receipt: Receipt; signatureValid: boolean; persistence: string }>('/api/receipts', body);
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
          el('div', undefined, 'row'),
        );
        slot.lastElementChild?.append(externalLink('Open on Celoscan', `https://celoscan.io/tx/${txHash}`));
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
    if (!entry?.dataset.receipt) return fail($('verify-out'), 'Nothing issued in this journal yet. Issue a receipt in step 3 first.');
    field('v-json').value = entry.dataset.receipt;
    ($('v-go') as HTMLButtonElement).click();
  });
}

async function loadJournal() {
  const slot = $('journal');
  try {
    const data = await call<{ receipts: Receipt[]; persistence: string }>('/api/receipts');
    $('journal-note').textContent = data.persistence === 'jsonl'
      ? 'Receipts issued on this instance, newest first. Hosted instances keep them only while the container lives.'
      : 'Receipts in this deployment’s journal, newest first.';
    if (!data.receipts.length) return show(slot, el('p', 'No receipts issued here yet. Step 3 produces the first one.', 'empty'));
    slot.replaceChildren(...data.receipts.map((r) => {
      const row = el('div', undefined, 'entry');
      row.dataset.receipt = JSON.stringify(r);
      row.append(
        el('b', `${r.comparison.verified ? 'VERIFIED' : 'FLAGGED'} · ${r.id.slice(0, 8)}`),
        el('span', r.txHash),
        el('span', new Date(r.createdAt).toISOString()),
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
wireFirm();
wireLedger();
wireTag();
wireVerify();
void loadHealth();
void loadJournal();
