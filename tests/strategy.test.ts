import { describe, expect, it } from "vitest";
import { quote, inventorySkew, RAY } from "../src/pricing.js";
import { realizedPnl, settle, isAdverse } from "../src/pnl.js";
import { handle } from "../src/handlers.js";

// Derived from RAY so a miscounted zero cannot silently change the rate.
const MID = RAY * 2n; // 2.0 quote per base
const BP10 = MID / 1_000n; // ten basis points of the mid
const BP20 = MID / 500n;   // twenty basis points of the mid
const CONFIG = { spreadBps: 20, maxBaseExposure: 1_000n, maxQuoteExposure: 10_000n, skewBpsPerFullScale: 10 };

const base = { midRay: MID, inventoryQuote: 5_000n, config: CONFIG };

describe("two-sided pricing", () => {
  it("sells base below the mid by half the spread when inventory is neutral", () => {
    const q = quote({ ...base, side: "sell", size: 100n, inventoryBase: 500n });
    expect(q.accepted).toBe(true);
    expect(q.priceRay).toBe(MID - BP10); // 10bps inside a 20bps spread
  });

  it("buys base above the mid by half the spread", () => {
    const q = quote({ ...base, side: "buy", size: 100n, inventoryBase: 500n });
    expect(q.priceRay).toBe(MID + MID / 1_000n);
  });

  it("tilts both sides down when the desk is long base", () => {
    const neutral = quote({ ...base, side: "sell", size: 100n, inventoryBase: 500n });
    const long = quote({ ...base, side: "sell", size: 100n, inventoryBase: 1_000n });
    expect(inventorySkew(1_000n, 1_000n, 10)).toBe(10);
    expect(long.priceRay).toBeLessThan(neutral.priceRay);
  });

  it("caps a buy by quote inventory and records why", () => {
    const q = quote({ ...base, inventoryQuote: 100n, side: "buy", size: 900n, inventoryBase: 0n });
    expect(q.size).toBeLessThan(900n);
    expect(q.trace.join(" ")).toMatch(/quote inventory/);
  });

  it("refuses once inventory is exhausted rather than quoting a fantasy size", () => {
    const q = quote({ ...base, side: "sell", size: 100n, inventoryBase: 0n });
    expect(q.accepted).toBe(false);
    expect(q.rejected).toBe("inventory exhausted");
  });

  it("is reproducible from its inputs", () => {
    const args = { ...base, side: "sell" as const, size: 100n, inventoryBase: 300n };
    expect(quote(args).priceRay).toBe(quote(args).priceRay);
  });
});

describe("maker P&L", () => {
  const BP10 = MID / 1_000n; // 10bps of mid
  const BP20 = MID / 500n;  // 20bps of mid
  const fill = (side: "buy" | "sell", priceRay: bigint, size = 1_000n) => ({ side, size, priceRay, midRay: MID });

  it("counts selling above the mid as profit", () => {
    expect(realizedPnl(fill("sell", MID + BP10))).toBe(1_000n * BP10);
  });

  it("counts buying below the mid as profit", () => {
    expect(realizedPnl(fill("buy", MID - BP10))).toBe(1_000n * BP10);
  });

  it("flags being picked off", () => {
    expect(isAdverse(fill("sell", MID - BP20))).toBe(true);
  });

  it("matches a constant half-spread desk when it captures exactly that spread", () => {
    const ledger = settle([fill("sell", MID + BP10), fill("buy", MID - BP10)], 20);
    expect(ledger.realizedPnlRay).toBe(ledger.baselinePnlRay);
    expect(ledger.fills).toBe(2);
    expect(ledger.adverseFills).toBe(0);
  });

  it("beats the baseline when it captures more than half the spread", () => {
    const ledger = settle([fill("sell", MID + BP20)], 20);
    expect(ledger.realizedPnlRay).toBeGreaterThan(ledger.baselinePnlRay);
  });

  it("expresses edge in basis points of turnover", () => {
    const ledger = settle([fill("sell", MID + BP10)], 20);
    expect(ledger.edgeBps).toBeCloseTo(10, 1);
  });

  it("is zero on a desk that trades exactly at the mid", () => {
    expect(settle([fill("sell", MID)], 20).realizedPnlRay).toBe(0n);
  });
});

describe("pricing HTTP response", () => {
  it("serializes to JSON with string rates, never raw BigInt", async () => {
    const { status, body } = await handle("pricing.quote", {
      midRay: MID.toString(), size: "100", spreadBps: 20, inventoryBase: "500", inventoryQuote: "5000",
    });
    expect(status).toBe(200);
    // A serverless response is JSON.stringify'd; a raw BigInt throws and crashes the function.
    expect(() => JSON.stringify(body)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(body));
    for (const q of parsed.quotes) {
      expect(typeof q.priceRay).toBe("string");
      expect(typeof q.size).toBe("string");
      expect(typeof q.midRay).toBe("string");
    }
  });
});
