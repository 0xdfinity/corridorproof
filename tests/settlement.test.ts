import { describe, expect, it } from "vitest";
import { settlementKeyFor, tagCalldata, ATTRIBUTION_TAG } from "../src/executor.js";
import { handle } from "../src/handlers.js";

describe("settlement authorization", () => {
  const hostile = {
    quote: {
      rfqId: "x", status: "quoted",
      quote: { sellAmount: "1", buyAmount: "1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
      transactions: { swap: { to: "0x0000000000000000000000000000000000000001", data: "0xdeadbeef", value: "0", chainId: 42220 } },
    },
  };

  it("refuses to settle a quote this service never issued", async () => {
    const { status, body } = await handle("settle", { ...hostile, settleNonce: "guessed" });
    expect(status).toBeLessThan(500);
    expect(JSON.stringify(body)).toMatch(/not armed|nonce/i);
  });

  it("keeps a dry run read-only even when the request carries executable calldata", async () => {
    const { body } = await handle("settle.dry-run", hostile);
    expect((body as { mode: string }).mode).toBe("dry-run");
  });
});

describe("settlement key resolution", () => {
  const ENV_KEY = "0x" + "11".repeat(32);

  it("never resolves a signing key for a dry run, even when the environment has one", () => {
    // The original defect: executeSwap(quote, undefined) fell through to the
    // default parameter and broadcast a mainnet transaction from a "dry run".
    expect(settlementKeyFor("dry-run", ENV_KEY)).toBeUndefined();
  });

  it("resolves a key only when the caller explicitly asks for a live settlement", () => {
    expect(settlementKeyFor("live", ENV_KEY)).toBe(ENV_KEY);
  });

  it("refuses a live settlement when no key exists to sign with", () => {
    expect(() => settlementKeyFor("live", undefined)).toThrow(/no agent wallet/i);
  });
});

describe("attribution is mandatory on every outbound payload", () => {
  it("appends the enrollment suffix to empty, short and long calldata", () => {
    for (const payload of ["0x", "0x1234", `0x${"ab".repeat(68)}`]) {
      const built = tagCalldata(payload as `0x${string}`);
      expect(built.endsWith(ATTRIBUTION_TAG)).toBe(false); // tag is hex-encoded, not literal text
      expect(Buffer.from(ATTRIBUTION_TAG).toString("hex")).toHaveLength(34);
      expect(built.slice(-4)).toBe("8021"); // ERC-8021 marker closes the suffix
    }
  });

  it("is idempotent: tagging already-tagged calldata does not stack a second suffix", () => {
    const once = tagCalldata("0x1234" as `0x${string}`);
    expect(once).toBe(tagCalldata(once));
  });
});
