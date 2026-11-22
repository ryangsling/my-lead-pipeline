import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, contacts, conversations, notificationChannels, notificationLog, services, workspaces } from "@/lib/db/schema";
import { ingestEndOfCall } from "@/lib/conversations/ingest";
import { notifyBookingCancelled } from "@/lib/notifications/events";
import { deliver, notify } from "@/lib/notifications/send";
import { sendMessage } from "@/lib/notifications/transport";
import fixture from "../fixtures/vapi/end-of-call-report.json";

vi.mock("@/lib/notifications/transport", () => ({ sendMessage: vi.fn() }));
let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));
const channelsRoute = await import("@/app/api/workspaces/[id]/notifications/route");
const testRoute = await import("@/app/api/notifications/test/route");

const send = vi.mocked(sendMessage);
const fast = { delaysMs: [0, 0, 0] };
const all = ["booking_new", "lead_captured", "call_no_booking", "form_submitted", "booking_cancelled"];
const link = { link: "https://hub.example/x" };

let workspaceId: string;
let telegramId: string;
let emailId: string;

const logs = () => db.select().from(notificationLog).where(eq(notificationLog.workspaceId, workspaceId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  session = { email: "admin@example.com" };
  send.mockReset();
  send.mockResolvedValue(undefined);
  await db.execute(sql`truncate workspaces cascade`);
  [{ id: workspaceId }] = await db
    .insert(workspaces)
    .values({ slug: "n", name: "N", webhookSecretEncrypted: encrypt("s") })
    .returning({ id: workspaces.id });
  const channels = await db
    .insert(notificationChannels)
    .values([
      { workspaceId, type: "telegram", target: "123", events: all },
      { workspaceId, type: "email", target: "owner@example.com", events: all },
    ])
    .returning();
  telegramId = channels.find((c) => c.type === "telegram")!.id;
  emailId = channels.find((c) => c.type === "email")!.id;
});

describe("deliver", () => {
  it("fails twice then succeeds: 3 attempts and sent", async () => {
    const [log] = await db
      .insert(notificationLog)
      .values({ workspaceId, channelId: telegramId, event: "booking_new", dedupeKey: "r1", payload: link })
      .returning();
    send.mockRejectedValueOnce(new Error("boom 1")).mockRejectedValueOnce(new Error("boom 2")).mockResolvedValue(undefined);
    expect(await deliver(log.id, fast)).toEqual({ ok: true });
    const [row] = await db.select().from(notificationLog).where(eq(notificationLog.id, log.id));
    expect(row).toMatchObject({ status: "sent", attempts: 3, error: null });
    expect(row.sentAt).not.toBeNull();
  });

  it("4 failures give failed, 4 attempts and the last error", async () => {
    const [log] = await db
      .insert(notificationLog)
      .values({ workspaceId, channelId: telegramId, event: "booking_new", dedupeKey: "r2", payload: link })
      .returning();
    send.mockRejectedValue(new Error("Telegram said no"));
    expect(await deliver(log.id, fast)).toEqual({ ok: false, error: "Delivery failed. Check the channel and provider settings." });
    const [row] = await db.select().from(notificationLog).where(eq(notificationLog.id, log.id));
    expect(row).toMatchObject({ status: "failed", attempts: 4, error: "Delivery failed. Check the channel and provider settings." });
    expect(send).toHaveBeenCalledTimes(4);
  });
});

describe("notify", () => {
  it("sends only to active channels subscribed to the event", async () => {
    await db.update(notificationChannels).set({ events: ["lead_captured"] }).where(eq(notificationChannels.id, telegramId));
    await notify(workspaceId, "booking_new", link, "k2");
    expect(send.mock.calls.map(([, channel]) => channel.type)).toEqual(["email"]);

    send.mockClear();
    await db.update(notificationChannels).set({ active: false }).where(eq(notificationChannels.id, emailId));
    await notify(workspaceId, "booking_new", link, "k3");
    expect(send).not.toHaveBeenCalled();
  });

  it("a repeated dedupe key sends nothing and stores only whitelisted fields", async () => {
    const dirty = { ...link, transcript: "AI: SECRET" } as never;
    await notify(workspaceId, "lead_captured", dirty, "k4");
    await notify(workspaceId, "lead_captured", dirty, "k4");
    expect(send).toHaveBeenCalledTimes(2);
    const rows = await logs();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain("SECRET");
  });
});

describe("call events", () => {
  const report = () => {
    const body = structuredClone(fixture) as { message: Record<string, unknown> & { call: Record<string, unknown> } };
    body.message.call.id = "call_notify";
    return body.message;
  };

  it("a resent end-of-call report gives one notification per channel", async () => {
    for (let i = 0; i < 3; i++) await ingestEndOfCall(workspaceId, report());
    const rows = await logs();
    expect(rows.map((r) => r.event).sort()).toEqual(["call_no_booking", "call_no_booking"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a call that booked sends booking_new, not call_no_booking", async () => {
    const [contact] = await db.insert(contacts).values({ workspaceId, name: "Ada", phoneE164: "+447700900123" }).returning();
    const [svc] = await db.insert(services).values({ workspaceId, name: "Cut", durationMin: 30, bufferMin: 0 }).returning();
    const [conversation] = await db
      .insert(conversations)
      .values({ workspaceId, channel: "web_voice", externalId: "call_notify", contactId: contact.id, outcome: "booked" })
      .returning();
    await db.insert(appointments).values({
      workspaceId,
      contactId: contact.id,
      serviceId: svc.id,
      conversationId: conversation.id,
      source: "web_voice",
      startAt: new Date("2030-01-01T10:00:00Z"),
      endAt: new Date("2030-01-01T10:30:00Z"),
      blockedUntil: new Date("2030-01-01T10:30:00Z"),
    });
    await ingestEndOfCall(workspaceId, report());
    expect((await logs()).map((r) => r.event)).toEqual(["booking_new", "booking_new"]);
    const [, , message] = send.mock.calls[0];
    expect(message.body).toContain("Name: Ada");
    expect(message.body).toContain("Service: Cut");
    expect(message.body).toContain("/w/n/conversations/");
  });

  it("a captured lead sends lead_captured", async () => {
    await db.insert(conversations).values({ workspaceId, channel: "web_voice", externalId: "call_notify", outcome: "lead" });
    await ingestEndOfCall(workspaceId, report());
    expect((await logs()).map((r) => r.event)).toEqual(["lead_captured", "lead_captured"]);
  });

  it("a cancelled booking sends booking_cancelled", async () => {
    const [svc] = await db.insert(services).values({ workspaceId, name: "Cut", durationMin: 30, bufferMin: 0 }).returning();
    const [a] = await db
      .insert(appointments)
      .values({
        workspaceId,
        serviceId: svc.id,
        source: "form",
        startAt: new Date("2030-01-01T10:00:00Z"),
        endAt: new Date("2030-01-01T10:30:00Z"),
        blockedUntil: new Date("2030-01-01T10:30:00Z"),
      })
      .returning();
    await notifyBookingCancelled(workspaceId, a.id);
    expect((await logs()).map((r) => r.event)).toEqual(["booking_cancelled", "booking_cancelled"]);
  });
});

describe("routes", () => {
  it("Send test logs one attempt and reports the provider's error", async () => {
    send.mockRejectedValue(new Error("chat not found"));
    const res = await testRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ workspaceId, channelId: telegramId }) }) as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Delivery failed. Check the channel and provider settings." });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await logs()).toMatchObject([{ event: "test", status: "failed", attempts: 1 }]);
  });

  it("Send test needs a channel of this workspace and a session", async () => {
    const body = (channelId: string) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ workspaceId, channelId }) }) as never;
    expect((await testRoute.POST(body(crypto.randomUUID()))).status).toBe(404);
    session = null;
    expect((await testRoute.POST(body(telegramId))).status).toBe(401);
  });

  it("saving channels adds, edits and removes, and rejects a bad email", async () => {
    const put = (channels: unknown[]) =>
      channelsRoute.PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ channels }) }) as never, { params: Promise.resolve({ id: workspaceId }) } as never);
    const bad = await put([{ type: "email", target: "not-an-email", events: [], active: true }]);
    expect(bad.status).toBe(422);
    const ok = await put([
      { id: telegramId, type: "telegram", target: "999", events: ["booking_new"], active: true },
      { type: "email", target: "new@example.com", events: all, active: true },
    ]);
    const { channels } = await ok.json();
    expect(channels.map((c: { target: string }) => c.target).sort()).toEqual(["999", "new@example.com"]);
  });
});
