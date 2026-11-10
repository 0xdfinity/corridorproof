/**
 * P&L is kept in quote-scaled-by-RAY units. Returning plain quote units would truncate
 * every small fill to zero, which is how the first version of this module reported a
 * profitable desk as flat.
 */

export type MakerFill = {
  /** Direction from the desk's point of view: it bought or sold the base token. */
  side: 'buy' | 'sell';
  size: bigint;
  /** Rate actually executed, quote per base, 1e27 fixed point. */
  priceRay: bigint;
  /** Reference mid at the moment of the fill, same units. */
  midRay: bigint;
};

export type DeskLedger = {
  fills: number;
  baseVolume: bigint;
  /** Quote currency turned over, in quote-ray units. */
  quoteVolumeRay: bigint;
  /** Signed gain against the mid, in quote-ray units. */
  realizedPnlRay: bigint;
  /** What a desk quoting a constant half-spread would have earned on the same flow. */
  baselinePnlRay: bigint;
  /** Fills where the desk traded through its own quote, i.e. was picked off. */
  adverseFills: number;
  /** Realised edge as a fraction of turnover, in basis points. */
  edgeBps: number;
};

/**
 * A maker earns by crossing the mid, so P&L is measured against the mid rather than
 * against what the counterparty says the trade was worth.
 */
export function realizedPnl(fill: MakerFill): bigint {
  const delta = fill.side === 'sell' ? fill.priceRay - fill.midRay : fill.midRay - fill.priceRay;
  return fill.size * delta;
}

export function isAdverse(fill: MakerFill): boolean {
  return realizedPnl(fill) < 0n;
}

/**
 * The baseline is the null hypothesis a strategy has to beat: constant half-spread,
 * no skew. Reporting both turns P&L from a number into a claim with a comparison.
 */
export function settle(fills: MakerFill[], spreadBps: number): DeskLedger {
  let baseVolume = 0n, quoteVolumeRay = 0n, pnl = 0n, baseline = 0n, adverse = 0;
  // Half of spreadBps expressed in parts per million, so fractional bps stay exact.
  const halfSpreadPpm = BigInt(Math.round(spreadBps * 50));
  for (const fill of fills) {
    baseVolume += fill.size;
    quoteVolumeRay += fill.size * fill.priceRay;
    const gain = realizedPnl(fill);
    pnl += gain;
    if (gain < 0n) adverse++;
    baseline += (fill.size * fill.midRay * halfSpreadPpm) / 1_000_000n;
  }
  // Scaled by a million so a sub-basis edge does not vanish into integer division.
  const edgeBps = quoteVolumeRay > 0n ? Number((pnl * 10_000n * 1_000_000n) / quoteVolumeRay) / 1_000_000 : 0;
  return { fills: fills.length, baseVolume, quoteVolumeRay, realizedPnlRay: pnl, baselinePnlRay: baseline, adverseFills: adverse, edgeBps };
}
