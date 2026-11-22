import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, workspaces } from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";
import { createWorkspace } from "@/lib/workspaces";

const { syncAssistant } = await import("@/lib/vapi/sync");

const server = setupServer();
const calls = { tools: 0, structured: 0, assistantCreate: 0, assistantUpdate: 0 };
type AssistantBody = {
  server: { url: string; headers: Record<string, string> };
  model: { tools?: { type: string }[]; toolIds: string[]; messages: { content: string }[] };
  voice: Record<string, string>;
  artifactPlan: { structuredOutputIds: string[] };
};
let lastAssistant: AssistantBody | null = null;

function defaultHandlers() {
  server.use(
    http.post("https://api.vapi.ai/tool", async ({ request }) => {
      calls.tools += 1;
      const body = (await request.json()) as { function: { name: string } };
      return HttpResponse.json({ id: `tool_${body.function.name}` });
    }),
    http.patch("https://api.vapi.ai/tool/:id", ({ params }) => HttpResponse.json({ id: params.id })),
    http.post("https://api.vapi.ai/structured-output", () => {
      calls.structured += 1;
      return HttpResponse.json({ id: "out_1" });
    }),
    http.patch("https://api.vapi.ai/structured-output/:id", ({ params }) => HttpResponse.json({ id: params.id })),
    http.post("https://api.vapi.ai/assistant", async ({ request }) => {
      calls.assistantCreate += 1;
      lastAssistant = (await request.json()) as AssistantBody;
      return HttpResponse.json({ id: "asst_1" });
    }),
    http.patch("https://api.vapi.ai/assistant/:id", async ({ request, params }) => {
      calls.assistantUpdate += 1;
      lastAssistant = (await request.json()) as AssistantBody;
      return HttpResponse.json({ id: params.id });
    }),
  );
}

const workspaceInput = {
  name: "Vapi Sync",
  slug: "int-vapi-sync",
  niche: "",
  country: "GB",
  timezone: "Europe/London",
  phoneDisplay: "",
  vapiMode: "own" as const,
  businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
};

let workspaceId = "";
let assistantId = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, workspaceInput.slug));
  calls.tools = 0;
  calls.structured = 0;
  calls.assistantCreate = 0;
  calls.assistantUpdate = 0;
  lastAssistant = null;
  defaultHandlers();

  const created = await createWorkspace(workspaceInput);
  workspaceId = "workspace" in created ? created.workspace.id : "";
  const [assistant] = await db
    .insert(assistants)
    .values({
      workspaceId,
      personaName: "Sync Receptionist",
      firstMessage: "Hi, I am the AI assistant. This call may be recorded.",
      systemPrompt: "You are the receptionist for {{business_name}}. Today is {{today}}.",
      voiceId: "voice_1",
    })
    .returning();
  assistantId = assistant.id;
  await saveIntegration("vapi", workspaceId, { privateKey: "private" }, { publicKey: "public" });
  await db.delete(assistantSyncs);
});
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await db.delete(workspaces).where(eq(workspaces.slug, workspaceInput.slug));
});

describe("syncAssistant", () => {
  it("creates tools, the structured output and the assistant on the first run", async () => {
    const result = await syncAssistant(assistantId);
    expect(result).toEqual({ ok: true, vapiAssistantId: "asst_1" });

    const [sync] = await db.select().from(assistantSyncs);
    expect(sync.vapiAssistantId).toBe("asst_1");
    expect(sync.vapiToolIds).toEqual({
      check_availability: "tool_check_availability",
      book_appointment: "tool_book_appointment",
      capture_lead: "tool_capture_lead",
    });
    expect(sync.structuredOutputIds).toEqual(["out_1"]);
    expect(sync.syncError).toBeNull();

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws.transferEnabled).toBe(false);
    expect(lastAssistant?.model.tools).toBeUndefined();
    const secret = decrypt(ws.webhookSecretEncrypted);
    expect(lastAssistant?.server.headers["x-vapi-secret"]).toBe(secret);
    expect(lastAssistant?.server.url).toBe("http://localhost:3000/api/vapi/webhook");
    expect(lastAssistant?.model.toolIds).toHaveLength(3);
    expect(lastAssistant?.model.messages[0].content).toContain("Vapi Sync");
    expect(lastAssistant?.model.messages[0].content).toContain('{{"now" | date:');
    expect(lastAssistant?.voice).toEqual({ provider: "11labs", voiceId: "voice_1", model: "eleven_flash_v2_5" });
    expect(lastAssistant?.artifactPlan.structuredOutputIds).toEqual(["out_1"]);
  });

  it("syncs the native transfer tool when enabled", async () => {
    await db.update(workspaces).set({ transferEnabled: true }).where(eq(workspaces.id, workspaceId));
    expect((await syncAssistant(assistantId)).ok).toBe(true);
    expect(lastAssistant?.model.tools).toMatchObject([{ type: "transferCall" }]);
  });

  it("updates in place on the second run", async () => {
    await syncAssistant(assistantId);
    const second = await syncAssistant(assistantId);
    expect(second).toEqual({ ok: true, vapiAssistantId: "asst_1" });
    expect(calls.tools).toBe(3);
    expect(calls.structured).toBe(1);
    expect(calls.assistantCreate).toBe(1);
    expect(calls.assistantUpdate).toBe(1);
    expect(await db.select().from(assistantSyncs)).toHaveLength(1);
  });

  it("stores Vapi's error and keeps the row", async () => {
    server.use(http.post("https://api.vapi.ai/assistant", () => HttpResponse.json({ message: "Insufficient credits" }, { status: 402 })));
    const result = await syncAssistant(assistantId);
    expect(result).toEqual({ ok: false, error: "Vapi billing check failed" });
    const [sync] = await db.select().from(assistantSyncs);
    expect(sync.syncError).toBe("Vapi billing check failed");
    expect(sync.vapiAssistantId).toBeNull();
  });
});
