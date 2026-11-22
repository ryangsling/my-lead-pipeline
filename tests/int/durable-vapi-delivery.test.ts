import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { delay, http, HttpResponse } from "msw";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sweep } from "@/app/api/cron/sweep/route";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import {
  assistantSyncs, assistants, contacts, conversations, jobs, messages, notificationChannels, notificationLog,
  urgentEvents, webhookEvents, workspaces,
} from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";
import { deliver, enqueue } from "@/lib/notifications/send";
import { acknowledgeUrgent } from "@/lib/notifications/urgent";
import { testEnv } from "../test-env";
import { googleServer, startGoogle } from "./helpers/world";

const pending = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void pending.push(fn),
}));
const { POST: webhook } = await import("@/app/api/vapi/webhook/route");
const { POST: tools } = await import("@/app/api/vapi/tools/route");

const drain = () => Promise.all(pending.splice(0).map((fn) => fn()));
const cron = async () => {
  const response = await sweep(new Request("http://localhost/api/cron/sweep", {
    headers: { authorization: `Bearer ${testEnv.CRON_SECRET}` },
  }));
  expect(response.status).toBe(200);
  return response.json();
};

const telegramUrl = "https://api.telegram.org/botfake/sendMessage";
const resendUrl = "https://api.resend.com/emails";
let telegramMessages: { chat_id: string; text: string }[];
let resendRequests: string[];
let resendMessages: Map<string, { to: string[]; text: string }>;

async function tenant(slug: string) {
  const assistantId = `assistant-${slug}`;
  const secret = `secret-${slug}`;
  const [workspace] = await db.insert(workspaces).values({
    slug, name: slug, webhookSecretEncrypted: encrypt(secret), country: "GB",
  }).returning();
  const [assistant] = await db.insert(assistants).values({
    workspaceId: workspace.id, personaName: slug, firstMessage: "AI notice", systemPrompt: "You are a receptionist.",
  }).returning();
  await db.insert(assistantSyncs).values({ workspaceId: workspace.id, assistantId: assistant.id, vapiAssistantId: assistantId });
  return { workspaceId: workspace.id, assistantId, secret };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;
let owner: Tenant;
const callId = "shared-external-call-id";

function post(handler: (request: Request) => Promise<Response>, secret: string, message: object) {
  return handler(new Request("http://localhost/vapi", {
    method: "POST", headers: { "x-vapi-secret": secret }, body: JSON.stringify({ message }),
  }));
}

function report({ assistantId, secret }: Tenant, name = "Ada") {
  return post(webhook, secret, {
    type: "end-of-call-report",
    call: { id: callId, assistantId, customer: { name, number: "+447700900123" } },
    endedAt: "2026-11-21T12:34:00Z", summary: `Summary for ${name}.`,
    artifact: { messages: [{ role: "user", message: `Transcript for ${name}` }] },
  });
}

function urgentCall(name: "capture_lead" | "notify_urgent" = "capture_lead") {
  return post(tools, owner.secret, {
    type: "tool-calls", call: { id: callId, assistantId: owner.assistantId },
    toolCallList: [{
      id: name, function: { name, arguments: { name: "Ada", phone: "+447700900123", problem: "Roof damage", urgency: "urgent" } },
    }],
  });
}

function channel(workspaceId: string, type: "telegram" | "email", target: string, events: string[]) {
  return db.insert(notificationChannels).values({ workspaceId, type, target, events });
}

const scopedConversations = (workspaceId: string) => db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId));
const scopedLogs = (workspaceId: string) => db.select().from(notificationLog).where(eq(notificationLog.workspaceId, workspaceId));
const scopedInbox = (workspaceId: string) => db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, workspaceId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  pending.length = 0;
  telegramMessages = [];
  resendRequests = [];
  resendMessages = new Map();
  googleServer.resetHandlers();
  googleServer.use(
    http.post(telegramUrl, async ({ request }) => {
      telegramMessages.push(await request.json() as typeof telegramMessages[number]);
      return HttpResponse.json({ ok: true });
    }),
    http.post(resendUrl, async ({ request }) => {
      const key = request.headers.get("idempotency-key");
      expect(key).toBeTruthy();
      resendRequests.push(key!);
      if (!resendMessages.has(key!)) resendMessages.set(key!, await request.json() as { to: string[]; text: string });
      return HttpResponse.json({ id: key });
    }),
  );
  await db.execute(sql`truncate workspaces, integrations cascade`);
  await saveIntegration("telegram", null, { botToken: "fake" }, {});
  await saveIntegration("resend", null, { apiKey: "fake" }, { from: "sender@example.com" });
  owner = await tenant("durable-a");
});

describe("end-of-call inbox", () => {
  it.each(["pending", "processing"] as const)("recovers an interrupted %s report from the authenticated sweep", async (state) => {
    await channel(owner.workspaceId, "telegram", "111", ["call_no_booking"]);
    expect((await report(owner)).status).toBe(200);
    pending.length = 0;
    expect(await scopedConversations(owner.workspaceId)).toHaveLength(0);
    expect(telegramMessages).toHaveLength(0);
    if (state === "processing") await db.update(webhookEvents).set({
      status: "processing", attempts: 1, nextAttemptAt: null, leaseUntil: new Date(0),
    }).where(eq(webhookEvents.workspaceId, owner.workspaceId));
    expect((await cron()).webhooks).toEqual({ examined: 1, succeeded: 1 });
    const [conversation] = await scopedConversations(owner.workspaceId);
    expect(conversation).toMatchObject({ externalId: callId, summary: "Summary for Ada." });
    expect(await db.select().from(messages).where(eq(messages.conversationId, conversation.id))).toMatchObject([
      { role: "user", content: "Transcript for Ada" },
    ]);
    expect(await scopedInbox(owner.workspaceId)).toMatchObject([
      { status: "succeeded", attempts: state === "pending" ? 1 : 2, leaseUntil: null, processedAt: expect.any(Date) },
    ]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
  });

  it("retries a failed inbox from duplicate deliveries after transcript storage and enqueues just one alert", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["call_no_booking"]);
    await db.execute(sql`create function int_block_outbox() returns trigger language plpgsql as
      $$ begin raise exception 'mock database failure enqueueing message'; end; $$`);
    await db.execute(sql`create trigger int_block_outbox before insert on notification_log
      for each row execute function int_block_outbox()`);
    try {
      expect((await report(owner)).status).toBe(200);
      await drain();
      expect(await scopedInbox(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 1, processedAt: null }]);
      expect(await db.select().from(messages)).toMatchObject([{ content: "Transcript for Ada" }]);
      expect(await scopedLogs(owner.workspaceId)).toHaveLength(0);
      expect(telegramMessages).toHaveLength(0);
    } finally {
      await db.execute(sql`drop function int_block_outbox() cascade`);
    }

    await db.update(webhookEvents).set({ nextAttemptAt: new Date(0) }).where(eq(webhookEvents.workspaceId, owner.workspaceId));
    const responses = await Promise.all([report(owner), report(owner)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await drain();
    expect(await scopedInbox(owner.workspaceId)).toMatchObject([{ status: "succeeded", attempts: 2, error: null }]);
    expect(await scopedConversations(owner.workspaceId)).toHaveLength(1);
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await db.select().from(messages)).toMatchObject([{ role: "user", content: "Transcript for Ada" }]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
  });

  it("reclaims an inbox when its completion write fails after the alert is queued", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["call_no_booking"]);
    await db.execute(sql`create function int_block_inbox_completion() returns trigger language plpgsql as
      $$ begin if new.status = 'succeeded' then raise exception 'mock inbox completion failure'; end if; return new; end; $$`);
    await db.execute(sql`create trigger int_block_inbox_completion before update on webhook_events
      for each row execute function int_block_inbox_completion()`);
    try {
      expect((await report(owner)).status).toBe(200);
      await expect(drain()).rejects.toThrow();
      expect(await scopedInbox(owner.workspaceId)).toMatchObject([
        { status: "processing", attempts: 1, processedAt: null, leaseUntil: expect.any(Date) },
      ]);
      expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "pending", attempts: 0 }]);
      expect(telegramMessages).toEqual([]);
    } finally {
      await db.execute(sql`drop function int_block_inbox_completion() cascade`);
    }

    await db.update(webhookEvents).set({ leaseUntil: new Date(0) }).where(eq(webhookEvents.workspaceId, owner.workspaceId));
    const recovered = await cron();
    expect(recovered.webhooks).toEqual({ examined: 1, succeeded: 1 });
    expect(recovered.notifications).toEqual({ examined: 1, sent: 1 });
    expect(await scopedInbox(owner.workspaceId)).toMatchObject([
      { status: "succeeded", attempts: 2, leaseUntil: null, processedAt: expect.any(Date) },
    ]);
    expect(await scopedConversations(owner.workspaceId)).toMatchObject([{ externalId: callId }]);
    expect(await db.select().from(contacts).where(eq(contacts.workspaceId, owner.workspaceId))).toHaveLength(1);
    expect(await db.select().from(messages).where(eq(messages.workspaceId, owner.workspaceId)))
      .toMatchObject([{ role: "user", content: "Transcript for Ada" }]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
  });

  it("processes identical external call IDs separately in distinct workspaces", async () => {
    const other = await tenant("durable-b");
    await channel(owner.workspaceId, "telegram", "111", ["call_no_booking"]);
    await channel(other.workspaceId, "telegram", "222", ["call_no_booking"]);
    expect((await report(owner, "Ada")).status).toBe(200);
    expect((await report(other, "Grace")).status).toBe(200);
    await drain();
    expect(await scopedInbox(owner.workspaceId)).toMatchObject([{ externalId: callId, status: "succeeded" }]);
    expect(await scopedInbox(other.workspaceId)).toMatchObject([{ externalId: callId, status: "succeeded" }]);
    expect(await scopedConversations(owner.workspaceId)).toMatchObject([{ summary: "Summary for Ada." }]);
    expect(await scopedConversations(other.workspaceId)).toMatchObject([{ summary: "Summary for Grace." }]);
    expect(await db.select().from(messages).where(eq(messages.workspaceId, owner.workspaceId)))
      .toMatchObject([{ content: "Transcript for Ada" }]);
    expect(await db.select().from(messages).where(eq(messages.workspaceId, other.workspaceId)))
      .toMatchObject([{ content: "Transcript for Grace" }]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", payload: { name: "Ada" } }]);
    expect(await scopedLogs(other.workspaceId)).toMatchObject([{ status: "sent", payload: { name: "Grace" } }]);
    expect(telegramMessages).toHaveLength(2);
    expect(telegramMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ chat_id: "111", text: expect.stringContaining("Summary for Ada.") }),
      expect.objectContaining({ chat_id: "222", text: expect.stringContaining("Summary for Grace.") }),
    ]));
  });

  it.each(["published", "replacement"] as const)("refuses an assistant ID that also appears as another workspace's %s mapping", async kind => {
    const other = await tenant("durable-b");
    await db.update(assistantSyncs).set(kind === "published"
      ? { vapiAssistantId: owner.assistantId }
      : { replacementVapiAssistantId: owner.assistantId })
      .where(eq(assistantSyncs.workspaceId, other.workspaceId));
    await channel(owner.workspaceId, "telegram", "111", ["call_no_booking"]);
    await channel(other.workspaceId, "telegram", "222", ["call_no_booking"]);

    const responses = await Promise.all([
      report(owner),
      report({ ...other, assistantId: owner.assistantId }, "Grace"),
    ]);
    await drain();
    expect(responses.map(response => response.status)).toEqual([401, 401]);
    for (const { workspaceId } of [owner, other]) {
      expect(await scopedInbox(workspaceId)).toEqual([]);
      expect(await scopedConversations(workspaceId)).toEqual([]);
      expect(await scopedLogs(workspaceId)).toEqual([]);
    }
    expect(telegramMessages).toEqual([]);
    expect(resendRequests).toEqual([]);
  });
});

describe("durable delivery attempts", () => {
  it("requires the log's workspace for delivery and status changes", async () => {
    const other = await tenant("durable-b");
    await channel(owner.workspaceId, "telegram", "111", ["lead_captured"]);
    const [queued] = await enqueue(owner.workspaceId, "lead_captured", { link: "https://hub.example" }, "scoped-delivery");

    expect(await deliver({ ...queued, workspaceId: other.workspaceId }, { once: true }))
      .toEqual({ ok: false, error: "Notification was removed" });
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "pending", attempts: 0 }]);
    expect(telegramMessages).toEqual([]);

    expect(await deliver(queued, { once: true })).toEqual({ ok: true });
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
  });

  it("bounds a stalled Telegram transport, marks it uncertain and avoids a resend", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["lead_captured"]);
    let requests = 0;
    googleServer.use(http.post(telegramUrl, async () => {
      requests++;
      await delay(2_500);
      return HttpResponse.error();
    }));
    const [queued] = await enqueue(owner.workspaceId, "lead_captured", { link: "https://hub.example" }, "stalled");
    const started = performance.now();
    await deliver(queued, { timeoutMs: 100 });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "uncertain", attempts: 1, sentAt: null, leaseUntil: null }]);
    expect(requests).toBe(1);
    expect(telegramMessages).toHaveLength(0);
    await cron();
    expect(requests).toBe(1);
  });

  it.each([
    { type: "email", expired: false },
    { type: "email", expired: true },
    { type: "telegram", expired: false },
  ] as const)("handles accepted $type with a failed sent update, expired key = $expired", async ({ type, expired }) => {
    await channel(owner.workspaceId, type, type === "email" ? "owner@example.com" : "111", ["lead_captured"]);
    const [queued] = await enqueue(owner.workspaceId, "lead_captured", { link: "https://hub.example" }, "commit-lost");
    await db.execute(sql`create function int_block_sent() returns trigger language plpgsql as
      $$ begin if new.status = 'sent' then raise exception 'mock database failure marking sent'; end if; return new; end; $$`);
    await db.execute(sql`create trigger int_block_sent before update on notification_log
      for each row execute function int_block_sent()`);
    try {
      await expect(deliver(queued)).rejects.toThrow();
      expect(await scopedLogs(owner.workspaceId)).toMatchObject([
        { status: "processing", attempts: 1, transport: type === "email" ? "resend" : "telegram", sentAt: null },
      ]);
      expect(resendMessages.size + telegramMessages.length).toBe(1);
    } finally {
      await db.execute(sql`drop function int_block_sent() cascade`);
    }

    await db.update(notificationLog).set({
      leaseUntil: new Date(0), ...(expired ? { firstAttemptAt: new Date(0) } : {}),
    }).where(eq(notificationLog.id, queued.id));
    await Promise.all([cron(), cron()]);
    const replayed = type === "email" && !expired;
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([
      { status: replayed ? "sent" : "uncertain", attempts: replayed ? 2 : 1, sentAt: replayed ? expect.any(Date) : null },
    ]);
    expect(resendMessages.size + telegramMessages.length).toBe(1);
    expect(resendRequests).toEqual(type === "email" ? (replayed ? [queued.id, queued.id] : [queued.id]) : []);
  });
});

describe("urgent callback deadlines", () => {
  it("recovers a known rejected urgent send after the post-response worker is interrupted", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback"]);
    let requests = 0;
    googleServer.use(http.post(telegramUrl, async ({ request }) => {
      requests++;
      if (requests === 1) return HttpResponse.json({ ok: false }, { status: 429 });
      telegramMessages.push(await request.json() as typeof telegramMessages[number]);
      return HttpResponse.json({ ok: true });
    }));
    expect((await urgentCall()).status).toBe(200);
    pending.length = 0;
    const [log] = await scopedLogs(owner.workspaceId);
    expect(log).toMatchObject({ status: "retryable", attempts: 1, nextAttemptAt: expect.any(Date) });
    expect(await db.select().from(urgentEvents)).toMatchObject([{ sent: false, deadlineMissedAt: null }]);
    expect(telegramMessages).toHaveLength(0);
    await db.update(notificationLog).set({ nextAttemptAt: new Date(0) }).where(eq(notificationLog.id, log.id));
    expect((await cron()).notifications).toEqual({ examined: 1, sent: 1 });
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "sent", attempts: 2 }]);
    expect(await db.select().from(urgentEvents)).toMatchObject([{ sent: true, deadlineMissedAt: null }]);
    expect(await scopedConversations(owner.workspaceId)).toMatchObject([{ outcome: "urgent", endedAt: null }]);
    expect(requests).toBe(2);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
  });

  it("enqueues during capture_lead before the call ends and escalates an unacknowledged primary delivery", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback"]);
    await channel(owner.workspaceId, "email", "backup@example.com", ["urgent_callback_escalation"]);
    googleServer.use(http.post(telegramUrl, async ({ request }) => {
      expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ status: "processing", event: "urgent_callback", attempts: 1 }]);
      expect(await scopedInbox(owner.workspaceId)).toHaveLength(0);
      expect(await db.select().from(urgentEvents)).toMatchObject([{ sent: false, deadlineAt: expect.any(Date) }]);
      telegramMessages.push(await request.json() as typeof telegramMessages[number]);
      return HttpResponse.json({ ok: true });
    }));
    const started = Date.now();
    const response = await urgentCall();
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].result).toContain("The team has been alerted");
    await drain();
    const [urgent] = await db.select().from(urgentEvents).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    expect(urgent.deadlineAt!.getTime()).toBeGreaterThanOrEqual(started + 60_000);
    expect(urgent).toMatchObject({ sent: true, acknowledgedAt: null, deadlineMissedAt: null });
    expect(await scopedConversations(owner.workspaceId)).toMatchObject([{ outcome: "urgent", endedAt: null }]);
    expect(await db.select().from(jobs)).toMatchObject([{ urgency: "urgent", problem: "Roof damage" }]);
    expect(telegramMessages).toHaveLength(1);
    expect(resendRequests).toHaveLength(0);
    expect((await report(owner)).status).toBe(200);
    await drain();
    expect(await scopedLogs(owner.workspaceId)).toHaveLength(1);

    await db.update(urgentEvents).set({ deadlineAt: new Date(0) }).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    expect((await cron()).urgent).toEqual({ examined: 1, escalated: 1 });
    await cron();
    expect(await db.select().from(urgentEvents)).toMatchObject([{ deadlineMissedAt: expect.any(Date), escalatedAt: expect.any(Date) }]);
    expect(await scopedLogs(owner.workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "urgent_callback", status: "sent" }),
      expect.objectContaining({ event: "urgent_callback_escalation", status: "sent" }),
    ]));
    expect(telegramMessages).toHaveLength(1);
    expect([...resendMessages.values()]).toMatchObject([{ to: ["backup@example.com"] }]);
    expect(resendRequests).toHaveLength(1);
  });

  it("uses the backup when no primary alert can be confirmed by the deadline", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback"]);
    await channel(owner.workspaceId, "email", "backup@example.com", ["urgent_callback_escalation"]);
    googleServer.use(http.post(telegramUrl, () => HttpResponse.error()));
    expect((await (await urgentCall("notify_urgent")).json()).results[0].result)
      .toContain("could not confirm an immediate alert");
    pending.length = 0;
    await db.update(urgentEvents).set({ deadlineAt: new Date(0) }).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    await cron();
    expect(await scopedLogs(owner.workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "urgent_callback", status: "uncertain", attempts: 1 }),
      expect.objectContaining({ event: "urgent_callback_escalation", status: "sent", attempts: 1 }),
    ]));
    expect(await db.select().from(urgentEvents)).toMatchObject([{ sent: true, deadlineMissedAt: expect.any(Date) }]);
    expect(telegramMessages).toHaveLength(0);
    expect([...resendMessages.values()]).toMatchObject([{ to: ["backup@example.com"] }]);
  });

  it("honors a scoped acknowledgement before the deadline", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback"]);
    await channel(owner.workspaceId, "email", "backup@example.com", ["urgent_callback_escalation"]);
    await urgentCall("notify_urgent");
    await drain();
    const [urgent] = await db.select().from(urgentEvents);
    const other = await tenant("durable-b");
    await acknowledgeUrgent(other.workspaceId, urgent.conversationId);
    expect((await db.select().from(urgentEvents))[0].acknowledgedAt).toBeNull();
    await acknowledgeUrgent(owner.workspaceId, urgent.conversationId);
    const [acknowledged] = await db.select().from(urgentEvents);
    expect(acknowledged.acknowledgedAt!.getTime()).toBeLessThan(urgent.deadlineAt!.getTime());
    await db.update(urgentEvents).set({ deadlineAt: acknowledged.acknowledgedAt }).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    expect((await cron()).urgent).toEqual({ examined: 0, escalated: 0 });
    expect(await db.select().from(urgentEvents)).toMatchObject([{ deadlineMissedAt: null, escalatedAt: null }]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ event: "urgent_callback", status: "sent" }]);
    expect(telegramMessages).toHaveLength(1);
    expect(resendRequests).toHaveLength(0);
  });

  it("alerts the backup once if acknowledgement arrives after the deadline but before the sweep", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback"]);
    await channel(owner.workspaceId, "email", "backup@example.com", ["urgent_callback_escalation"]);
    expect((await urgentCall("notify_urgent")).status).toBe(200);
    await drain();
    const [urgent] = await db.select().from(urgentEvents).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    const deadline = new Date(Date.now() - 1_000);
    await db.update(urgentEvents).set({ deadlineAt: deadline }).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    await acknowledgeUrgent(owner.workspaceId, urgent.conversationId);
    const [acknowledged] = await db.select().from(urgentEvents).where(eq(urgentEvents.workspaceId, owner.workspaceId));
    expect(acknowledged.acknowledgedAt!.getTime()).toBeGreaterThan(deadline.getTime());

    expect((await cron()).urgent).toEqual({ examined: 1, escalated: 1 });
    expect((await cron()).urgent).toEqual({ examined: 0, escalated: 0 });
    expect(await db.select().from(urgentEvents).where(eq(urgentEvents.workspaceId, owner.workspaceId))).toMatchObject([
      { acknowledgedAt: acknowledged.acknowledgedAt, deadlineMissedAt: expect.any(Date), escalatedAt: expect.any(Date) },
    ]);
    expect(await scopedLogs(owner.workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "urgent_callback", status: "sent", attempts: 1 }),
      expect.objectContaining({ event: "urgent_callback_escalation", status: "sent", attempts: 1 }),
    ]));
    expect(await scopedInbox(owner.workspaceId)).toEqual([]);
    expect(telegramMessages).toMatchObject([{ chat_id: "111" }]);
    expect(resendRequests).toHaveLength(1);
    expect([...resendMessages.values()]).toMatchObject([{ to: ["backup@example.com"] }]);
  });

  it("records a missed deadline when no distinct backup is configured", async () => {
    await channel(owner.workspaceId, "telegram", "111", ["urgent_callback", "urgent_callback_escalation"]);
    await urgentCall();
    await drain();
    await db.update(urgentEvents).set({ deadlineAt: new Date(0) }).where(and(eq(urgentEvents.workspaceId, owner.workspaceId), eq(urgentEvents.sent, true)));
    expect((await cron()).urgent).toEqual({ examined: 1, escalated: 0 });
    expect(await db.select().from(urgentEvents)).toMatchObject([{ deadlineMissedAt: expect.any(Date), escalatedAt: null }]);
    expect(await scopedLogs(owner.workspaceId)).toMatchObject([{ event: "urgent_callback", status: "sent" }]);
    expect(telegramMessages).toHaveLength(1);
    expect(resendRequests).toHaveLength(0);
  });
});
