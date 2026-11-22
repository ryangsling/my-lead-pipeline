import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { delay, http, HttpResponse } from "msw";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/integrations/chat-providers/route";
import { POST as testProvider } from "@/app/api/integrations/chat-providers/[id]/test/route";
import { OPTIONS, POST } from "@/app/api/public/[pk]/chat/route";
import { CHAT_INTERRUPTED, CHAT_UNAVAILABLE } from "@/lib/chat/model";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { chatProviders, contacts, conversations, embeds, messages, notificationChannels, notificationLog } from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";
import { googleServer, seedWorld, startGoogle } from "./helpers/world";

let admin: { email: string } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: admin } }) } }),
}));

const primaryKey = "chat-private-key_primary_AA0987654";
const backupKey = "chat-private-key_backup_BB9876543";
const pk = "pk_test_chat";
const origin = "https://site.example";
const primary = { name: "Primary", baseUrl: "https://primary.example/v1", model: "first-model", apiKey: primaryKey, enabled: true, toolCapable: true };
const backup = { name: "Backup", baseUrl: "https://backup.example/v1", model: "backup-model", apiKey: backupKey, enabled: true, toolCapable: true };
type ProviderDraft = Pick<typeof primary, "name" | "baseUrl" | "model" | "enabled" | "toolCapable"> & { apiKey?: string; id?: string; timeoutMs?: number };
type ProviderRequest = { model: string; messages: { role: string; content: unknown }[]; tools: unknown[]; stream?: boolean; tool_choice?: unknown };
let workspaceId: string;
let calls: { model: string; authorized: boolean; body: ProviderRequest }[];

const api = "http://localhost:3000/api/integrations/chat-providers";
const scoped = (scope?: string) => scope ? `?workspaceId=${scope}` : "";
const save = (providers: ProviderDraft[], workspace?: string) => PUT(new Request(api + scoped(workspace), {
  method: "PUT", body: JSON.stringify(providers),
}));
const test = (id: string, workspace?: string) => testProvider(new Request(`${api}/${id}/test${scoped(workspace)}`, { method: "POST" }), {
  params: Promise.resolve({ id }),
});
const chatRequest = (sessionId: string, from = origin) => new Request(`http://localhost:3000/api/public/${pk}/chat`, {
  method: "POST", headers: { origin: from }, body: JSON.stringify({ sessionId, message: "Can you help?" }),
});
const chatCtx = () => ({ params: Promise.resolve({ pk }) });
async function chat(sessionId = crypto.randomUUID()) {
  const response = await POST(chatRequest(sessionId), chatCtx());
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  return response.text();
}

function mockProvider(provider: typeof primary, getResponse: (request: ProviderRequest) => Response | Promise<Response>) {
  return http.post(`${provider.baseUrl}/chat/completions`, async ({ request }) => {
    const body = await request.json() as ProviderRequest;
    calls.push({ model: body.model, authorized: request.headers.get("authorization") === `Bearer ${provider.apiKey}`, body });
    return getResponse(body);
  });
}

const headers = { "content-type": "text/event-stream" };
const chunk = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", created: 1, model: "mock-model",
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const streaming = (...chunks: string[]) => new HttpResponse(chunks.join("") + "data: [DONE]\n\n", { headers });
const output = (text: string) => streaming(chunk({ content: text }), chunk({}, "stop"));
const toolDelta = (name: string, args: string) => chunk({
  tool_calls: [{ index: 0, id: "tool-1", type: "function", function: { name, arguments: args } }],
});
const toolOutput = (name: string, args: string) => streaming(toolDelta(name, args), chunk({}, "tool_calls"));
const probe = (value: string) => HttpResponse.json({
  id: "completion", object: "chat.completion", created: 1, model: "mock-model",
  choices: [{ index: 0, finish_reason: "tool_calls", message: {
    role: "assistant", content: null,
    tool_calls: [{ id: "tool-test", type: "function", function: { name: "verify_tool_support", arguments: JSON.stringify({ value }) } }],
  } }],
});
const assistantMessages = () => db.select().from(messages)
  .innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(eq(conversations.workspaceId, workspaceId))
  .orderBy(asc(messages.createdAt)).then(rows => rows.map(row => row.messages).filter(row => row.role === "assistant"));
const providers = () => db.select().from(chatProviders).orderBy(asc(chatProviders.position));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  googleServer.resetHandlers();
  ({ workspaceId } = await seedWorld());
  await db.delete(chatProviders);
  await db.insert(embeds).values({ workspaceId, publicKey: pk, allowedOrigins: [origin] });
  admin = { email: "admin@example.com" };
  calls = [];
});

describe("chat provider chain", () => {
  it("uses the backup after 429, shares the Retry-After cooldown across sessions, and resumes after expiry", async () => {
    expect((await save([primary, backup])).status).toBe(200);
    googleServer.use(
      mockProvider(primary, () => new HttpResponse(null, { status: 429, headers: { "retry-after": "120" } })),
      mockProvider(backup, () => output("Backup response.")),
    );
    const now = Date.now();
    expect(await chat()).toBe("Backup response.");
    const [cooled] = await providers();
    expect(cooled.cooldownUntil!.getTime() - now).toBeGreaterThanOrEqual(120_000);
    expect(cooled.cooldownUntil!.getTime() - now).toBeLessThan(125_000);
    expect(cooled.timeoutMs).toBe(8_000);
    expect(await chat()).toBe("Backup response.");
    expect(calls.map(call => [call.model, call.authorized])).toEqual([
      [primary.model, true], [backup.model, true], [backup.model, true],
    ]);
    await db.update(chatProviders).set({ cooldownUntil: new Date(now - 1) }).where(eq(chatProviders.id, cooled.id));
    googleServer.use(mockProvider(primary, () => output("Primary is back.")));
    expect(await chat()).toBe("Primary is back.");
    expect(calls.map(call => call.model)).toEqual([primary.model, backup.model, backup.model, primary.model]);
    expect(await assistantMessages()).toMatchObject([
      { providerName: backup.name, providerModel: backup.model, content: "Backup response." },
      { providerName: backup.name, providerModel: backup.model, content: "Backup response." },
      { providerName: primary.name, providerModel: primary.model, content: "Primary is back." },
    ]);
  });

  it("alerted the workspace owner when every provider failed and used the default cooldown", async () => {
    await save([primary, backup]);
    await saveIntegration("telegram", workspaceId, { botToken: "test-chat-telegram" }, {});
    await db.insert(notificationChannels).values({ workspaceId, type: "telegram", target: "123", events: ["chat_unavailable"] });
    const alerts: { chat_id: string; text: string }[] = [];
    googleServer.use(
      mockProvider(primary, () => new HttpResponse(null, { status: 429 })),
      mockProvider(backup, () => new HttpResponse(null, { status: 503 })),
      http.post("https://api.telegram.org/bottest-chat-telegram/sendMessage", async ({ request }) => {
        alerts.push(await request.json() as typeof alerts[number]);
        return HttpResponse.json({ ok: true });
      }),
    );
    const now = Date.now();
    expect(await chat()).toBe(CHAT_UNAVAILABLE);
    const [cooled] = await providers();
    expect(cooled.cooldownUntil!.getTime() - now).toBeGreaterThanOrEqual(300_000);
    expect(cooled.cooldownUntil!.getTime() - now).toBeLessThan(305_000);
    expect(calls.map(call => call.model)).toEqual([primary.model, backup.model]);
    expect(await assistantMessages()).toMatchObject([{ providerName: null, providerModel: null, content: CHAT_UNAVAILABLE }]);
    expect(await db.select().from(notificationLog).where(eq(notificationLog.workspaceId, workspaceId))).toMatchObject([
      { event: "chat_unavailable", status: "sent", attempts: 1, payload: { summary: "The chatbot could not reach a configured provider." } },
    ]);
    expect(alerts).toMatchObject([{ chat_id: "123", text: expect.stringContaining("/w/bloom/conversations/") }]);
    expect(alerts[0].text).toContain("Chat providers unavailable");
    expect(alerts[0].text).not.toContain("Can you help?");
  });

  it("uses an HTTP-date Retry-After and skips a provider put in cooldown by its test", async () => {
    const response = await save([primary, backup]);
    const { providers: [first] } = await response.json();
    const until = new Date(Math.floor(Date.now() / 1_000) * 1_000 + 90_000);
    googleServer.use(
      mockProvider(primary, () => new HttpResponse(null, { status: 429, headers: { "retry-after": until.toUTCString() } })),
      mockProvider(backup, () => output("Still available.")),
    );
    expect(await (await test(first.id)).json()).toEqual({ passed: false });
    expect((await providers())[0]).toMatchObject({ cooldownUntil: until, testPassed: false });
    expect(await chat()).toBe("Still available.");
    expect(calls.map(call => [call.model, Boolean(call.body.stream)])).toEqual([[primary.model, false], [backup.model, true]]);
  });

  it.each([
    ["5xx", () => new HttpResponse(null, { status: 502 })],
    ["network failure", () => HttpResponse.error()],
    ["timeout", async () => { await delay(450); return output("Too late."); }],
    ["malformed tool JSON", () => toolOutput("capture_lead", "{bad")],
    ["invalid tool parameters", () => toolOutput("capture_lead", '{"name":"Ada"}')],
    ["unknown tool", () => toolOutput("not_a_tool", "{}")],
  ] as const)("switches before any streamed output on %s", async (reason, failure) => {
    await save([{ ...primary, timeoutMs: reason === "timeout" ? 100 : 8_000 }, backup]);
    googleServer.use(mockProvider(primary, failure), mockProvider(backup, () => output("Recovered.")));
    expect(await chat()).toBe("Recovered.");
    expect(calls.map(call => call.model)).toEqual([primary.model, backup.model]);
    expect(await assistantMessages()).toMatchObject([{ providerModel: backup.model, content: "Recovered." }]);
    expect(await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId))).toEqual([]);
    expect((await providers())[0].cooldownUntil).toBeNull();
  });

  it("streams the first text before a failure and keeps that provider without calling the backup", async () => {
    await save([primary, backup]);
    let fail!: () => void;
    const failAfterFirstToken = new Promise<void>(resolve => { fail = resolve; });
    googleServer.use(
      mockProvider(primary, () => new HttpResponse(new ReadableStream<Uint8Array>({
        async start(controller) {
          const encode = new TextEncoder();
          controller.enqueue(encode.encode(chunk({ content: "Primary began." })));
          await failAfterFirstToken;
          controller.enqueue(encode.encode('data: {"error":{"message":"connection broke","type":"server_error"}}\n\n'));
          controller.close();
        },
      }), { headers })),
      mockProvider(backup, () => output("Unexpected switch.")),
    );
    const response = await POST(chatRequest(crypto.randomUUID()), chatCtx());
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      expect(decoder.decode((await reader.read()).value)).toBe("Primary began.");
    } finally {
      fail();
    }
    expect(decoder.decode((await reader.read()).value)).toBe(`\n\n${CHAT_INTERRUPTED}`);
    expect((await reader.read()).done).toBe(true);
    expect(calls.map(call => call.model)).toEqual([primary.model]);
    expect(await assistantMessages()).toMatchObject([{ providerName: primary.name, providerModel: primary.model,
      content: `Primary began.\n\n${CHAT_INTERRUPTED}` }]);
  });

  it("carries an executed tool result to the backup without creating a second lead", async () => {
    await save([primary, backup]);
    let primaryCalls = 0;
    googleServer.use(
      mockProvider(primary, () => ++primaryCalls === 1
        ? toolOutput("capture_lead", '{"name":"Ada","phone":"07700 900123","reason":"Callback"}')
        : new HttpResponse(null, { status: 503 })),
      mockProvider(backup, () => output("The team will call you.")),
    );
    expect(await chat()).toBe("The team will call you.");
    expect(calls.map(call => call.model)).toEqual([primary.model, primary.model, backup.model]);
    expect(calls[2].body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", content: expect.stringContaining("Saved, the team will call you") }),
    ]));
    expect(await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId))).toMatchObject([
      { name: "Ada", phoneE164: "+447700900123", source: "chat" },
    ]);
    expect(await db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId))).toMatchObject([{ outcome: "lead", chatTurnId: null }]);
    expect(await assistantMessages()).toMatchObject([{ providerModel: backup.model }]);
    expect(await db.select().from(messages).where(eq(messages.toolName, "capture_lead"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool_call", providerModel: primary.model }),
      expect.objectContaining({ role: "tool_result", providerModel: primary.model }),
    ]));
  });
});

describe("chat administration", () => {
  it("keeps encrypted keys out of responses, errors, streamed text and logs", async () => {
    const logs = ["log", "info", "warn", "error"].map(level =>
      vi.spyOn(console, level as "log").mockImplementation(() => {}));
    try {
      const saved = await save([primary, backup]);
      const adminBody = await saved.text();
      const read = await (await GET(new Request(api))).text();
      const [first] = (await providers());
      expect(first.apiKeyEncrypted).not.toContain(primaryKey);
      expect(decrypt(first.apiKeyEncrypted)).toBe(primaryKey);
      googleServer.use(
        mockProvider(primary, () => HttpResponse.json({ error: { message: primaryKey } }, { status: 503 })),
        mockProvider(backup, () => streaming(
          chunk({ content: "Credential echo: " + backupKey.slice(0, 20) }),
          chunk({ content: backupKey.slice(20) }),
          chunk({}, "stop"),
        )),
      );
      const testBody = await (await test(first.id)).text();
      expect(testBody).toBe('{"passed":false}');
      const publicBody = await chat();
      expect(publicBody).toBe("Credential echo: [redacted]");
      const transcript = JSON.stringify(await assistantMessages());
      for (const value of [adminBody, read, testBody, publicBody, transcript, JSON.stringify(logs.flatMap(log => log.mock.calls))]) {
        expect(value).not.toContain(primaryKey);
        expect(value).not.toContain(backupKey);
        expect(value).not.toContain(first.apiKeyEncrypted);
        expect(value).not.toContain("apiKeyEncrypted");
      }
      expect(calls.map(call => call.authorized)).toEqual([true, true, true]);
    } finally {
      logs.forEach(log => log.mockRestore());
    }
  });

  it("probes one tool and records a failed and a passed test for the configured model", async () => {
    await save([primary]);
    const [first] = await providers();
    googleServer.use(mockProvider(primary, () => probe("wrong")));
    expect(await (await test(first.id)).json()).toEqual({ passed: false });
    expect((await providers())[0]).toMatchObject({ testPassed: false, testedAt: expect.any(Date) });
    googleServer.use(mockProvider(primary, () => probe("ready")));
    expect(await (await test(first.id)).json()).toEqual({ passed: true });
    expect((await providers())[0]).toMatchObject({ testPassed: true, testedAt: expect.any(Date) });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({ model: primary.model, authorized: true, body: { tool_choice: "required" } });
      expect(call.body.tools).toHaveLength(1);
    }
  });

  it("uses only enabled, tool-capable workspace rows, can reorder without re-entering keys, and restores global after removal", async () => {
    await save([primary]);
    const local = await save([{ ...primary, toolCapable: false }, { ...backup, enabled: false }, backup], workspaceId);
    const { providers: [unmarked, disabled, active] } = await local.json();
    const reordered = await save([
      { ...backup, id: active.id, apiKey: undefined }, { ...primary, id: unmarked.id, toolCapable: false, apiKey: undefined },
      { ...backup, id: disabled.id, enabled: false, apiKey: undefined },
    ], workspaceId);
    expect((await reordered.json()).providers.map((row: { id: string }) => row.id)).toEqual([active.id, unmarked.id, disabled.id]);
    expect((await test(active.id)).status).toBe(404);
    expect((await test(unmarked.id, workspaceId)).status).toBe(200);
    googleServer.use(mockProvider(primary, () => output("Global.")), mockProvider(backup, () => output("Workspace.")));
    expect(await chat()).toBe("Workspace.");
    await save([], workspaceId);
    expect(await chat()).toBe("Global.");
    expect(calls.map(call => [call.model, call.authorized])).toEqual([[backup.model, true], [primary.model, true]]);
  });

  it("rejects disallowed browser origins, unauthorized administration and chains longer than five", async () => {
    expect((await save(Array(6).fill(primary))).status).toBe(422);
    expect(await providers()).toEqual([]);
    admin = null;
    expect((await GET(new Request(api))).status).toBe(401);
    expect((await save([primary])).status).toBe(401);
    expect((await POST(chatRequest(crypto.randomUUID(), "https://unapproved.example"), chatCtx())).status).toBe(403);
    const preflight = await OPTIONS(new Request(`http://localhost:3000/api/public/${pk}/chat`, {
      method: "OPTIONS", headers: { origin },
    }), chatCtx());
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(calls).toEqual([]);
    expect(await db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId))).toEqual([]);
  });
});
