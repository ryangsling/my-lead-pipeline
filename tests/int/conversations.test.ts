import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, contacts, conversations, messages, webhookEvents, workspaces } from "@/lib/db/schema";
import { ingestEndOfCall } from "@/lib/conversations/ingest";
import { createWorkspace } from "@/lib/workspaces";
import fixture from "../fixtures/vapi/end-of-call-report.json";

const pending = vi.hoisted(() => [] as Promise<void>[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void pending.push(fn()),
}));
const { POST } = await import("@/app/api/vapi/webhook/route");

const VAPI_ASSISTANT = "asst_conv";
let workspaceId: string;
let secret: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, "int-conversations"));
});
beforeEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, "int-conversations"));
  await db.delete(webhookEvents);
  const created = await createWorkspace({
    name: "Conversations",
    slug: "int-conversations",
    niche: "",
    country: "GB",
    timezone: "Europe/London",
    phoneDisplay: "",
    vapiMode: "own",
    businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
  });
  if (!("workspace" in created)) throw new Error("workspace not created");
  workspaceId = created.workspace.id;
  const [assistant] = await db
    .insert(assistants)
    .values({ workspaceId, personaName: "A", firstMessage: "Hi, AI assistant, may be recorded.", systemPrompt: "x" })
    .returning();
  await db.insert(assistantSyncs).values({ assistantId: assistant.id, vapiAssistantId: VAPI_ASSISTANT });
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  secret = decrypt(row.webhookSecretEncrypted);
});

/** The real captured report, re-pointed at the test assistant and call id. */
function report(overrides: { callId?: string; customer?: { number: string }; type?: string } = {}) {
  const body = structuredClone(fixture) as { message: Record<string, unknown> & { call: Record<string, unknown> } };
  body.message.call = { ...body.message.call, id: overrides.callId ?? "call_conv_1", assistantId: VAPI_ASSISTANT };
  if (overrides.customer) body.message.call.customer = overrides.customer;
  if (overrides.type) body.message.call.type = overrides.type;
  return body;
}

const send = async (body: unknown) => {
  const res = await POST(new Request("http://localhost/api/vapi/webhook", { method: "POST", headers: { "x-vapi-secret": secret }, body: JSON.stringify(body) }));
  await Promise.all(pending.splice(0));
  return res;
};

const allConversations = () => db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId));

describe("end-of-call ingest", () => {
  it("uses only reserved example domains in the report fixture", () => {
    const urls = JSON.stringify(fixture).match(/https?:\/\/[^" ]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => new URL(url).hostname.endsWith(".example"))).toBe(true);
  });

  it("the sanitized report fills every conversation field", async () => {
    expect((await send(report())).status).toBe(200);
    const [row] = await allConversations();
    expect(row).toMatchObject({
      channel: "web_voice",
      externalId: "call_conv_1",
      durationS: 19,
      outcome: "no_booking",
      contactId: null,
    });
    expect(Number(row.costUsd)).toBeCloseTo(0.0238, 4);
    expect(row.summary).toContain("AI assistant");
    expect(row.recordingUrl).toContain(".wav");
    expect(row.startedAt?.toISOString()).toBe("2026-11-10T17:31:31.389Z");
    expect(row.endedAt?.toISOString()).toBe("2026-11-10T17:31:50.412Z");
    expect(row.structured).toMatchObject({ booked: false, service: "" });

    const rows = await db.select().from(messages).where(eq(messages.conversationId, row.id));
    expect(rows.map((m) => [m.role, m.content])).toEqual([
      ["assistant", "Hi. You're speaking with Example's AI assistant. This call may be recorded. How can I help you today?"],
    ]);
    const [event] = await db.select().from(webhookEvents);
    expect(event.processedAt).not.toBeNull();
    expect(event.error).toBeNull();
  });

  it("the same webhook sent 3 times gives 1 conversation, 1 contact and one set of messages", async () => {
    const body = report({ customer: { number: "+447700900123" } });
    for (let i = 0; i < 3; i++) expect((await send(body)).status).toBe(200);
    expect(await allConversations()).toHaveLength(1);
    expect(await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId))).toHaveLength(1);
    const [row] = await allConversations();
    expect(row.contactId).not.toBeNull();
    expect(await db.select().from(messages).where(eq(messages.conversationId, row.id))).toHaveLength(1);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
  });

  it("ingesting the same report twice directly keeps one set of transcript rows", async () => {
    const body = report({ customer: { number: "07700 900123" } });
    await ingestEndOfCall(workspaceId, body.message);
    await ingestEndOfCall(workspaceId, body.message);
    const [row] = await allConversations();
    expect(await db.select().from(messages).where(eq(messages.conversationId, row.id))).toHaveLength(1);
    expect((await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)))[0].phoneE164).toBe("+447700900123");
  });

  it("updates the conversation a tool already made, keeping its outcome, data and tool rows", async () => {
    const [made] = await db
      .insert(conversations)
      .values({ workspaceId, channel: "web_voice", externalId: "call_conv_1", outcome: "booked", structured: { name: "Ada" } })
      .returning();
    await db.insert(messages).values([
      { conversationId: made.id, role: "tool_call", toolName: "book_appointment", content: "{}" },
      { conversationId: made.id, role: "tool_result", toolName: "book_appointment", content: "Booked." },
    ]);
    await send(report());
    const rows = await allConversations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: made.id, outcome: "booked", durationS: 19 });
    expect(rows[0].structured).toMatchObject({ name: "Ada", booked: false });
    const kept = await db.select().from(messages).where(eq(messages.conversationId, made.id));
    expect(kept.map((m) => m.role).sort()).toEqual(["assistant", "tool_call", "tool_result"]);
  });

  it("a phone call with a customer number creates the contact and links it", async () => {
    await send(report({ type: "inboundPhoneCall", customer: { number: "+447700900456" } }));
    const [row] = await allConversations();
    expect(row.channel).toBe("phone");
    const [contact] = await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId));
    expect(row.contactId).toBe(contact.id);
    expect(contact.source).toBe("phone");
  });

  it("an unparsable payload stays in webhook_events with error set and returns 200", async () => {
    const body = report();
    body.message.cost = "not a number";
    expect((await send(body)).status).toBe(200);
    expect(await allConversations()).toHaveLength(0);
    const [event] = await db.select().from(webhookEvents);
    expect(event.error).toBeTruthy();
    expect(event.processedAt).not.toBeNull();
  });
});
