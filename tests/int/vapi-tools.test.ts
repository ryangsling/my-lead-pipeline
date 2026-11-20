import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, assistantSyncs, assistants, conversations, messages, workspaces } from "@/lib/db/schema";
import fixture from "../fixtures/vapi/tool-calls.json";
import { googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

const { POST } = await import("@/app/api/vapi/tools/route");

let workspaceId: string;
let otherWorkspaceId: string;

async function withAssistant(id: string, vapiAssistantId: string) {
  const [assistant] = await db
    .insert(assistants)
    .values({ workspaceId: id, personaName: "A", firstMessage: "Hi, I am an AI assistant. This call may be recorded.", systemPrompt: "x" })
    .returning();
  await db.insert(assistantSyncs).values({ assistantId: assistant.id, vapiAssistantId });
}

const post = (body: unknown, secret: string | null = "secret") =>
  POST(
    new Request("http://localhost/api/vapi/tools", {
      method: "POST",
      headers: secret ? { "x-vapi-secret": secret } : {},
      body: JSON.stringify(body),
    }),
  );

const payload = (toolCallList: unknown[], callId = "call_fixture") => ({
  message: { ...fixture.message, call: { ...fixture.message.call, id: callId }, toolCallList },
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  ({ workspaceId } = await seedWorld());
  await withAssistant(workspaceId, "assistant_fixture");
  const [other] = await db
    .insert(workspaces)
    .values({ slug: "other", name: "Other", webhookSecretEncrypted: encrypt("other-secret") })
    .returning();
  otherWorkspaceId = other.id;
  await withAssistant(otherWorkspaceId, "assistant_other");
});

describe("/api/vapi/tools", () => {
  it("answers the real-shape fixture with the contract shape", async () => {
    const res = await post(fixture);
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toEqual([
      { name: "check_availability", toolCallId: "toolu_fixture_1", result: expect.stringContaining("Cut has these times free") },
    ]);
  });

  it("rejects a missing secret, a wrong secret and another workspace's secret", async () => {
    expect((await post(fixture, null)).status).toBe(401);
    expect((await post(fixture, "wrong")).status).toBe(401);
    expect((await post(fixture, "other-secret")).status).toBe(401);
  });

  it("rejects a payload that is not a tool call", async () => {
    expect((await post({ message: { type: "status-update", call: fixture.message.call } })).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });

  it("creates one conversation per call and logs calls and results", async () => {
    await post(fixture);
    await post(fixture);
    const rows = await db.select().from(conversations).where(eq(conversations.externalId, "call_fixture"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId, channel: "web_voice" });
    const logged = await db.select().from(messages).where(eq(messages.conversationId, rows[0].id));
    expect(logged.map((m) => m.role).sort()).toEqual(["tool_call", "tool_call", "tool_result", "tool_result"]);
    expect(logged.find((m) => m.role === "tool_call")?.content).toBe(JSON.stringify({ service: "Cut" }));
  });

  it("books through the tool call and accepts string arguments", async () => {
    const args = JSON.stringify({ service: "Cut", start: slot(2, 10).toISO(), name: "Ada", phone: "07700 900123" });
    const res = await post(payload([{ id: "t1", type: "function", function: { name: "book_appointment", arguments: args } }]));
    const { results } = await res.json();
    expect(results[0].result).toContain("You are booked in for Cut");
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("returns a sentence, never a 500, for an unknown tool or bad arguments", async () => {
    const res = await post(
      payload([
        { id: "t1", type: "function", function: { name: "nope", arguments: {} } },
        { id: "t2", type: "function", function: { name: "book_appointment", arguments: { service: "Cut" } } },
      ]),
    );
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { toolCallId: string }) => r.toolCallId)).toEqual(["t1", "t2"]);
    expect(results[0].result).toContain("I cannot do that");
    expect(results[1].result).toContain("I am missing some details");
  });

  it("uses the workspace behind the assistant, not the arguments", async () => {
    const args = { service: "Cut", start: slot(2, 10).toISO(), name: "Ada", phone: "07700 900123", workspaceId: otherWorkspaceId };
    await post(payload([{ id: "t1", type: "function", function: { name: "book_appointment", arguments: args } }]));
    const rows = await db.select().from(appointments);
    expect(rows.map((r) => r.workspaceId)).toEqual([workspaceId]);
  });
});
