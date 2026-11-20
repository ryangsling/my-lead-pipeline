/**
 * Times 50 check_availability calls against /api/vapi/tools with the workspace's real secret.
 * Usage: pnpm exec tsx --env-file=.env.local scripts/measure-tools.ts [slug] [baseUrl]
 * baseUrl defaults to APP_URL (the tunnel). The secret is read server-side and never printed.
 */
import { and, eq, like } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, conversations, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";

const slug = process.argv[2] ?? "bloom";
const base = (process.argv[3] ?? env.APP_URL).replace(/\/+$/, "");
const CALLS = 50;

async function main() {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!workspace) throw new Error(`No workspace with slug ${slug}`);
  const [sync] = await db
    .select({ vapiAssistantId: assistantSyncs.vapiAssistantId })
    .from(assistantSyncs)
    .innerJoin(assistants, eq(assistants.id, assistantSyncs.assistantId))
    .where(eq(assistants.workspaceId, workspace.id));
  const [service] = await db
    .select({ name: services.name })
    .from(services)
    .where(and(eq(services.workspaceId, workspace.id), eq(services.active, true)));
  if (!sync || !service) throw new Error("The workspace needs a synced assistant and an active service");

  const callId = `measure_${Date.now()}`;
  const body = JSON.stringify({
    message: {
      type: "tool-calls",
      call: { id: callId, assistantId: sync.vapiAssistantId, type: "webCall" },
      toolCallList: [{ id: "t1", type: "function", function: { name: "check_availability", arguments: { service: service.name } } }],
    },
  });
  const headers = { "content-type": "application/json", "x-vapi-secret": decrypt(workspace.webhookSecretEncrypted) };

  const times: number[] = [];
  let sample = "";
  for (let i = 0; i <= CALLS; i++) {
    const started = performance.now();
    const res = await fetch(`${base}/api/vapi/tools`, { method: "POST", headers, body });
    const elapsed = performance.now() - started;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    sample = (await res.json()).results[0].result;
    if (i > 0) times.push(elapsed); // the first call warms the route
  }

  times.sort((a, b) => a - b);
  const at = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
  console.log(`${CALLS} calls to ${base}: p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${Math.round(times.at(-1) as number)} ms`);
  console.log(`Reply: ${sample}`);
  if (sample.includes("cannot check the calendar")) console.log("Note: Google Calendar is not connected, so this timed the error path only.");

  await db.delete(conversations).where(and(eq(conversations.workspaceId, workspace.id), like(conversations.externalId, "measure_%")));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
