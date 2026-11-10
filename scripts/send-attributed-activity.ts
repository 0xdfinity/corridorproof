/**
 * Operator tool: sends the first attributed activity for an enrollment and proves it
 * came back tagged. Deliberately requires ATTRIBUTION_ALLOW_TX so it cannot fire by
 * accident from a web handler.
 */
process.env.ATTRIBUTION_ALLOW_TX = "yes";

const { handle } = await import("../src/handlers.js");

const agent = process.argv[2];
const value = process.argv[3] ?? "0";
if (!agent || !/^0x[0-9a-fA-F]{40}$/.test(agent)) {
  console.error("usage: npx tsx scripts/send-attributed-activity.ts <celo-address> [value-wei]");
  process.exit(1);
}

const result = await handle("attribution.send", { to: agent, value });
console.log(`send ${result.status} ` + JSON.stringify(result.body));

const body = result.body as { txHash?: string };
if (result.status === 200 && body.txHash) {
  const proof = await handle("attribution.read", { txHash: body.txHash });
  console.log(`proof ${proof.status} ` + JSON.stringify(proof.body));
}
