import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, webhookEvents, workspaces } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/workspaces";

const pending = vi.hoisted(() => [] as Promise<void>[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void pending.push(fn()),
}));
const { POST } = await import("@/app/api/vapi/webhook/route");

const slugs = ["int-webhook-a", "int-webhook-b"];
const secrets: Record<string, string> = {};

const input = (slug: string) => ({
  name: slug,
  slug,
  niche: "",
  country: "GB",
  timezone: "Europe/London",
  phoneDisplay: "",
  vapiMode: "own" as const,
  businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
});

async function makeWorkspace(slug: string, vapiAssistantId: string) {
  const created = await createWorkspace(input(slug));
  if (!("workspace" in created)) throw new Error("workspace not created");
  const workspaceId = created.workspace.id;
  const [assistant] = await db
    .insert(assistants)
    .values({
      workspaceId,
      personaName: "Webhook",
      firstMessage: "Hi, I am the AI assistant. This call may be recorded.",
      systemPrompt: "You are the receptionist.",
    })
    .returning();
  await db.insert(assistantSyncs).values({ workspaceId, assistantId: assistant.id, vapiAssistantId });
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  secrets[slug] = decrypt(row.webhookSecretEncrypted);
}

const payload = (type: string, extra: Record<string, unknown> = {}) => ({
  message: {
    type,
    call: { id: "call_1", assistantId: "asst_a" },
    ...extra,
  },
});

const post = async (body: unknown, secret?: string) => {
  const res = await POST(
    new Request("http://localhost/api/vapi/webhook", {
      method: "POST",
      headers: secret ? { "x-vapi-secret": secret } : {},
      body: JSON.stringify(body),
    }),
  );
  await Promise.all(pending.splice(0));
  return res;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  await db.delete(workspaces).where(inArray(workspaces.slug, slugs));
  await db.delete(webhookEvents);
  await makeWorkspace("int-webhook-a", "asst_a");
  await makeWorkspace("int-webhook-b", "asst_b");
});
afterAll(async () => {
  await db.delete(workspaces).where(inArray(workspaces.slug, slugs));
});

describe("POST /api/vapi/webhook", () => {
  it("rejects a missing or wrong secret, and a secret from another workspace", async () => {
    expect((await post(payload("status-update", { status: "ended" }))).status).toBe(401);
    expect((await post(payload("status-update", { status: "ended" }), "wrong")).status).toBe(401);
    expect((await post(payload("status-update", { status: "ended" }), secrets["int-webhook-b"])).status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("refuses a disabled or archived transfer even when a number is supplied", async () => {
    const secret = secrets["int-webhook-a"];
    const body = payload("transfer-destination-request", { number: "+12025550101" });
    expect(await (await post(body, secret)).json()).toHaveProperty("error");
    await db.update(workspaces).set({ transferEnabled: true, status: "archived", backupNumber: "+12025550102" })
      .where(eq(workspaces.slug, "int-webhook-a"));
    expect(await (await post(body, secret)).json()).toHaveProperty("error");
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("stores the raw payload once and returns 200", async () => {
    const body = payload("end-of-call-report", { endedReason: "hangup" });
    expect((await post(body, secrets["int-webhook-a"])).status).toBe(200);
    expect((await post(body, secrets["int-webhook-a"])).status).toBe(200);

    const rows = await db.select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "vapi", eventType: "end-of-call-report", externalId: "call_1" });
    expect(rows[0].raw).toEqual(body);
  });

  it("strips the workspace secret Vapi echoes in assistant.server.headers", async () => {
    const body = payload("end-of-call-report", {
      assistant: {
        server: {
          url: "https://hub.test/api/vapi/webhook",
          headers: { "x-vapi-secret": secrets["int-webhook-a"] },
        },
        model: {
          tools: [{ server: { url: "https://hub.test/api/vapi/tools", headers: { "x-vapi-secret": secrets["int-webhook-a"] } } }],
        },
      },
    });
    expect((await post(body, secrets["int-webhook-a"])).status).toBe(200);
    const [row] = await db.select().from(webhookEvents);
    const stored = row.raw as {
      message: {
        assistant: {
          server: { url?: string; headers?: unknown };
          model: { tools: { server: { headers?: unknown } }[] };
        };
      };
    };
    expect(stored.message.assistant.server.headers).toBeUndefined();
    expect(stored.message.assistant.model.tools[0].server.headers).toBeUndefined();
    expect(stored.message.assistant.server.url).toBe("https://hub.test/api/vapi/webhook");
  });

  it("keys status updates by call id and status", async () => {
    await post(payload("status-update", { status: "in-progress" }), secrets["int-webhook-a"]);
    await post(payload("status-update", { status: "ended" }), secrets["int-webhook-a"]);
    const rows = await db.select().from(webhookEvents);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["call_1:ended", "call_1:in-progress"]);
  });
});
