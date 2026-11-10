/**
 * Two-sided maker pricing. Everything here is pure arithmetic over 1e27 fixed-point
 * rates so a quote can be reproduced from its inputs and audited line by line.
 */

export const RAY = 10n ** 27n;

export type PricingConfig = {
  /** Half-spread quoted in basis points of the mid. */
  spreadBps: number;
  /** Maximum base inventory the desk will hold. */
  maxBaseExposure: bigint;
  /** Maximum quote inventory the desk will hold. */
  maxQuoteExposure: bigint;
  /** How hard the book tilts per full unit of inventory utilisation, in bps. */
  skewBpsPerFullScale: number;
};

export type Side = 'buy' | 'sell';

export type QuoteDecision = {
  accepted: boolean;
  side: Side;
  /** Price the desk is willing to trade at, as an ray (1e27) rate of quote per base. */
  priceRay: bigint;
  /** Quantity the desk will actually take, after exposure caps. */
  size: bigint;
  /** Mid the decision was taken from. */
  midRay: bigint;
  /** Every step that produced this number, in order. */
  trace: string[];
  rejected: string | null;
};

const bps = (value: bigint, basisPoints: number) => value * BigInt(Math.round(basisPoints * 100)) / 10_000_00n;

/** Signed tilt in bps: long base pushes both sides down, short base pushes them up. */
export function inventorySkew(inventoryBase: bigint, maxBaseExposure: bigint, skewBpsPerFullScale: number) {
  if (maxBaseExposure <= 0n) return 0;
  const utilisation = Number(inventoryBase) / Number(maxBaseExposure);
  const centred = Math.max(-1, Math.min(1, utilisation * 2 - 1));
  return Math.round(centred * skewBpsPerFullScale * 100) / 100;
}

export function quote(input: {
  side: Side;
  size: bigint;
  midRay: bigint;
  inventoryBase: bigint;
  inventoryQuote: bigint;
  config: PricingConfig;
}): QuoteDecision {
  const { side, midRay, config } = input;
  const trace: string[] = [];

  if (midRay <= 0n) return { accepted: false, side, priceRay: 0n, size: 0n, midRay, trace: ['mid must be positive'], rejected: 'invalid mid' };
  if (input.size <= 0n) return { accepted: false, side, priceRay: 0n, size: 0n, midRay, trace: ['size must be positive'], rejected: 'invalid size' };

  const half = bps(midRay, config.spreadBps / 2);
  trace.push(`half-spread ${config.spreadBps / 2}bps = ${half} ray`);

  const skew = inventorySkew(input.inventoryBase, config.maxBaseExposure, config.skewBpsPerFullScale);
  const skewRay = bps(midRay, skew / 100);
  trace.push(`inventory ${input.inventoryBase}/${config.maxBaseExposure} base tilts ${skew}bps = ${skewRay} ray`);

  // Selling base: the desk bids quote, so the price it pays is mid minus spread, tilted down when already long.
  // Buying base: the desk offers quote at mid plus spread, tilted the same way.
  const priceRay = side === 'sell' ? midRay - half - skewRay : midRay + half - skewRay;
  trace.push(`${side} price = ${priceRay} ray`);

  let size = input.size;
  if (side === 'buy') {
    const affordable = priceRay > 0n ? (input.inventoryQuote * RAY) / priceRay : 0n;
    if (affordable < size) {
      trace.push(`capped by quote inventory ${input.inventoryQuote} to size ${affordable}`);
      size = affordable;
    }
    const room = config.maxBaseExposure - input.inventoryBase;
    if (room < size) {
      trace.push(`capped by base exposure room ${room} to size ${room > 0n ? room : 0n}`);
      size = room > 0n ? room : 0n;
    }
  } else {
    if (input.inventoryBase < size) {
      trace.push(`capped by base inventory ${input.inventoryBase}`);
      size = input.inventoryBase;
    }
  }

  if (size <= 0n) {
    trace.push('no capacity left on this side');
    return { accepted: false, side, priceRay, size: 0n, midRay, trace, rejected: 'inventory exhausted' };
  }

  const notional = (size * priceRay) / RAY;
  if (config.maxQuoteExposure > 0n && notional > config.maxQuoteExposure) {
    const shrunk = (config.maxQuoteExposure * RAY) / priceRay;
    trace.push(`notional ${notional} exceeds quote cap ${config.maxQuoteExposure}, size reduced to ${shrunk}`);
    size = shrunk;
    if (size <= 0n) return { accepted: false, side, priceRay, size: 0n, midRay, trace, rejected: 'quote cap' };
  }

  trace.push(`quoting ${size} at ${priceRay} ray, notional ${(size * priceRay) / RAY}`);
  return { accepted: true, side, priceRay, size, midRay, trace, rejected: null };
}
