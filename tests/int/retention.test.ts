import { and, eq, isNotNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { delay, http, HttpResponse } from "msw";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/contacts/route";
import { GET as audit } from "@/app/api/contacts/deletions/route";
import { GET as sweep } from "@/app/api/cron/sweep/route";
import { bookAppointment } from "@/lib/booking/book";
import { updateAppointmentStatus } from "@/lib/booking/status";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import {
  appointments, assistantSyncs, assistants, calendars, contacts, conversations, deletionLog, jobs, messages,
  notificationLog, offeredSlots, toolReceipts, urgentEvents, webhookEvents, workspaces, type CalendarOperation,
} from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";
import { processWebhookAfterReply } from "@/lib/vapi/events";
import { testEnv } from "../test-env";
import { google, googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

const session = vi.hoisted(() => ({ failure: 0 }));
vi.mock("@/lib/auth", async original => {
  const auth = await original<typeof import("@/lib/auth")>();
  return { ...auth, requireAdmin: async () => {
    if (session.failure) throw new auth.AuthError(session.failure as 401 | 403);
    return { email: "admin@example.com" };
  } };
});
const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async original => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void scheduled.push(fn),
}));
const { POST: webhook } = await import("@/app/api/vapi/webhook/route");
const { POST: tools } = await import("@/app/api/vapi/tools/route");

const vapiApi = "https://api.vapi.ai/call";
const phone = "+447700900321";
const email = "privacy@example.com";
const personName = "Erasure Example";
const pii = "Private job details";
const old = () => new Date(Date.now() - 14 * 86_400_000);
const expired = new Date(0);
let owner: Awaited<ReturnType<typeof configureTenant>>;
let other: Awaited<ReturnType<typeof configureTenant>>;
let serviceId: string;
let provider: {
  calls: Map<string, string>;
  media: Set<string>;
  deletes: string[];
  requests: string[];
  authFailure: boolean;
  slowRead: boolean;
  lostDeleteReply: boolean;
  pendingMediaRemoval: boolean;
};

async function configureTenant(workspaceId: string, slug: string, retentionDays: number) {
  const assistantId = `assistant-${slug}`;
  const secret = `secret-${slug}`;
  await db.update(workspaces).set({ retentionDays, webhookSecretEncrypted: encrypt(secret) }).where(eq(workspaces.id, workspaceId));
  const [assistant] = await db.insert(assistants).values({
    workspaceId, personaName: slug, firstMessage: "AI assistant", systemPrompt: "Test assistant",
  }).returning();
  await db.insert(assistantSyncs).values({ workspaceId, assistantId: assistant.id, vapiAssistantId: assistantId });
  await saveIntegration("vapi", workspaceId, { privateKey: "shared-test-account" }, {});
  return { workspaceId, assistantId, secret };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  session.failure = 0;
  scheduled.length = 0;
  const world = await seedWorld();
  serviceId = world.serviceId;
  owner = await configureTenant(world.workspaceId, "privacy-owner", 7);
  const [ws] = await db.insert(workspaces).values({ slug: "other-privacy", name: "Other workspace", webhookSecretEncrypted: "unused" }).returning();
  other = await configureTenant(ws.id, "privacy-other", 120);
  provider = {
    calls: new Map(), media: new Set(), deletes: [], requests: [],
    authFailure: false, slowRead: false, lostDeleteReply: false, pendingMediaRemoval: false,
  };
  googleServer.resetHandlers();
  googleServer.use(
    http.get(`${vapiApi}/:id`, async ({ params, request }) => {
      const id = String(params.id);
      provider.requests.push(`get ${id}`);
      expect(request.headers.get("authorization")).toBe("Bearer shared-test-account");
      if (provider.slowRead) await delay(4_200);
      if (provider.authFailure) return HttpResponse.json({ error: "private sentinel detail" }, { status: 403 });
      return provider.calls.has(id) ? HttpResponse.json({ id, assistantId: provider.calls.get(id) })
        : HttpResponse.json({}, { status: 404 });
    }),
    http.delete(`${vapiApi}/:id`, ({ params, request }) => {
      const id = String(params.id);
      expect(request.headers.get("authorization")).toBe("Bearer shared-test-account");
      provider.deletes.push(id);
      provider.calls.delete(id);
      if (!provider.pendingMediaRemoval) provider.media.delete(id);
      return provider.lostDeleteReply ? HttpResponse.error() : new HttpResponse(null, { status: 204 });
    }),
    http.get(`${vapiApi}/:id/:media`, ({ params }) => {
      const id = String(params.id);
      provider.requests.push(`${params.media} ${id}`);
      return provider.media.has(id)
        ? new HttpResponse(null, { status: 302, headers: { Location: "https://signed.example/recording" } })
        : new HttpResponse(null, { status: 404 });
    }),
  );
});

async function cron(secret = testEnv.CRON_SECRET) {
  return sweep(new Request("http://localhost/api/cron/sweep", { headers: { authorization: `Bearer ${secret}` } }));
}
function request(workspaceId: string, id?: string) {
  const params = new URLSearchParams({ workspaceId });
  if (id) params.set("id", id);
  return new Request(`http://localhost/api/contacts?${params}`, { method: id ? "DELETE" : "GET" });
}
function vapiPost(handler: (req: Request) => Promise<Response>, tenant: typeof owner, message: object) {
  return handler(new Request("http://localhost/api/vapi", {
    method: "POST", headers: { "x-vapi-secret": tenant.secret }, body: JSON.stringify({ message }),
  }));
}
async function makeContact(workspaceId: string, createdAt = new Date(), phoneE164 = phone) {
  const [contact] = await db.insert(contacts).values({
    workspaceId, createdAt, name: personName, phoneE164, email, notes: pii, tags: ["private tag"],
  }).returning();
  return contact;
}
async function makeConversation(workspaceId: string, contactId: string | null, callId: string, createdAt = new Date(), assistantId?: string) {
  const [call] = await db.insert(conversations).values({
    workspaceId, contactId, createdAt, externalId: callId, channel: "phone", summary: pii,
    structured: { phone, email, address: pii }, recordingUrl: "https://recording.example/secret", vapiAssistantId: assistantId,
  }).returning();
  return call;
}
async function makeCallCopies(call: Awaited<ReturnType<typeof makeConversation>>, assistantId: string) {
  const { workspaceId, id: conversationId, externalId: callId, contactId, createdAt } = call;
  await db.insert(messages).values(["user", "assistant", "tool_call", "tool_result"].map(role => ({
    workspaceId, conversationId, role, content: pii,
  })));
  await db.insert(toolReceipts).values({ workspaceId, callId: callId!, toolCallId: "unique-tool", name: "capture_lead", result: pii });
  await db.insert(jobs).values({ workspaceId, conversationId, contactId, address: pii, problem: pii, timezone: "Europe/London", createdAt });
  await db.insert(urgentEvents).values({ workspaceId, conversationId, payload: { phone, pii }, deadlineAt: expired });
  await db.insert(notificationLog).values([
    { workspaceId, event: "lead_captured", dedupeKey: `lead_captured:${conversationId}`, payload: { phone, pii } },
    { workspaceId, event: "urgent_callback", dedupeKey: `urgent_callback:${conversationId}`, urgentConversationId: conversationId, payload: { phone, pii } },
  ]);
  await db.insert(webhookEvents).values({
    workspaceId, source: "vapi", eventType: "end-of-call-report", externalId: callId!, callId, vapiAssistantId: assistantId,
    raw: { message: { call: { customer: { number: phone } }, summary: pii } }, receivedAt: createdAt, status: "succeeded",
  });
}
const contactList = (workspaceId: string) => db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId));
const callList = (workspaceId: string) => db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId));
const providerTasks = (workspaceId: string) => db.select().from(deletionLog)
  .where(and(eq(deletionLog.workspaceId, workspaceId), isNotNull(deletionLog.requestId)));
const retryNow = (workspaceId: string) => db.update(deletionLog).set({ nextAttemptAt: expired })
  .where(and(eq(deletionLog.workspaceId, workspaceId), eq(deletionLog.status, "retryable")));
const dueReport = (tenant: typeof owner, callId: string) => vapiPost(webhook, tenant, {
  type: "end-of-call-report", call: { id: callId, assistantId: tenant.assistantId, customer: { name: personName, number: phone } },
  summary: pii, artifact: { messages: [{ role: "user", message: pii }] },
});

describe("retention and contact erasure", () => {
  it("applies configured age to all local copies and verifies old Vapi calls while preserving newer records and the other workspace", async () => {
    const obsolete = await makeContact(owner.workspaceId, old());
    const obsoleteCall = await makeConversation(owner.workspaceId, obsolete.id, "same-call", old(), owner.assistantId);
    await makeCallCopies(obsoleteCall, owner.assistantId);
    await db.insert(offeredSlots).values({ workspaceId: owner.workspaceId, conversationId: obsoleteCall.id,
      serviceId, start: slot(1, 10).toJSDate(), expiresAt: new Date(Date.now() + 600_000) });
    const fresh = await makeContact(owner.workspaceId, new Date(), "+447700900322");
    const freshCall = await makeConversation(owner.workspaceId, fresh.id, "fresh-call", new Date(), owner.assistantId);
    const shared = await makeContact(other.workspaceId, old());
    await makeCallCopies(await makeConversation(other.workspaceId, shared.id, "same-call", old(), other.assistantId), other.assistantId);
    await db.insert(notificationLog).values({
      workspaceId: owner.workspaceId, event: "lead_captured", dedupeKey: "unknown-age-test", payload: { pii }, createdAt: old(),
    });
    await db.insert(webhookEvents).values({
      workspaceId: null, eventType: "status-update", source: "vapi", raw: { pii }, externalId: "legacy:ended",
      status: "unscoped", receivedAt: old(),
    });
    await db.insert(toolReceipts).values({ workspaceId: owner.workspaceId, callId: "receipt-only", toolCallId: "legacy",
      name: "capture_lead", result: pii, createdAt: old() });
    provider.calls.set("same-call", owner.assistantId);
    provider.calls.set("fresh-call", owner.assistantId);
    provider.calls.set("receipt-only", owner.assistantId);
    provider.media.add("same-call");

    expect((await cron("wrong-secret")).status).toBe(401);
    expect(await callList(owner.workspaceId)).toHaveLength(2);
    const response = await cron();
    expect(await response.json()).toMatchObject({ retention: { erased: 1, failed: 0, unscoped: 1 }, providerDeletions: { verified: 2 } });

    expect(await contactList(owner.workspaceId)).toMatchObject([{ id: fresh.id }]);
    expect(await callList(owner.workspaceId)).toMatchObject([{ id: freshCall.id }]);
    expect(await contactList(other.workspaceId)).toMatchObject([{ id: shared.id }]);
    expect(await callList(other.workspaceId)).toMatchObject([{ externalId: "same-call" }]);
    expect(await db.select().from(messages).where(eq(messages.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(toolReceipts).where(eq(toolReceipts.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(urgentEvents).where(eq(urgentEvents.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(offeredSlots).where(eq(offeredSlots.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(notificationLog).where(eq(notificationLog.workspaceId, owner.workspaceId))).toEqual([]);
    expect(await db.select().from(webhookEvents)).toMatchObject([{ workspaceId: other.workspaceId }]);
    expect(provider.calls.get("fresh-call")).toBe(owner.assistantId);
    expect(provider.calls.has("same-call")).toBe(false);
    expect(provider.media.has("same-call")).toBe(false);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([
      { status: "verified", targetEncrypted: null, verifiedAt: expect.any(Date) },
      { status: "verified", targetEncrypted: null, verifiedAt: expect.any(Date) },
    ]);
    expect(await providerTasks(other.workspaceId)).toEqual([]);
  });

  it("requires an admin, erases an individual contact immediately and prevents delayed reports and tool replays", async () => {
    const person = await makeContact(owner.workspaceId);
    const otherPerson = await makeContact(other.workspaceId);
    const call = await makeConversation(owner.workspaceId, person.id, "operator-call", new Date(), owner.assistantId);
    await makeCallCopies(call, owner.assistantId);
    provider.calls.set("operator-call", owner.assistantId);
    provider.calls.set("pending-report", owner.assistantId);
    expect((await dueReport(owner, "pending-report")).status).toBe(200);
    expect(scheduled).toHaveLength(1);
    session.failure = 401;
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(401);
    expect((await audit(request(owner.workspaceId))).status).toBe(401);
    session.failure = 403;
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(403);
    session.failure = 0;
    expect((await DELETE(request(other.workspaceId, person.id))).status).toBe(404);
    const response = await DELETE(request(owner.workspaceId, person.id));
    expect(response.status).toBe(202);
    const { deletionId } = await response.json() as { deletionId: string };
    expect(await contactList(owner.workspaceId)).toEqual([]);
    expect(await contactList(other.workspaceId)).toMatchObject([{ id: otherPerson.id }]);
    expect(provider.calls.size).toBe(2);
    await Promise.all(scheduled.splice(0).map(run => run()));
    await processWebhookAfterReply({ workspaceId: owner.workspaceId, source: "vapi", externalId: "operator-call" });
    expect((await dueReport(owner, "operator-call")).status).toBe(200);
    expect((await vapiPost(webhook, owner, { type: "status-update", status: "ended",
      call: { id: "operator-call", assistantId: owner.assistantId } })).status).toBe(200);
    const replay = await vapiPost(tools, owner, { type: "tool-calls",
      call: { id: "operator-call", assistantId: owner.assistantId }, toolCallList: [
        { id: "unique-tool", function: { name: "capture_lead", arguments: { name: personName, phone } } },
      ] });
    expect(await replay.json()).toMatchObject({ results: [{ result: "We can't book right now. Please call back." }] });
    expect(await callList(owner.workspaceId)).toEqual([]);
    expect(await db.select().from(webhookEvents)).toEqual([]);
    expect(await db.select().from(notificationLog)).toEqual([]);
    expect(scheduled).toEqual([]);
    expect((await cron()).status).toBe(200);
    expect(provider.calls.size).toBe(0);
    const entries = await audit(new Request(`http://localhost/api/contacts/deletions?workspaceId=${owner.workspaceId}&requestId=${deletionId}`));
    expect(await entries.json()).toMatchObject({ deletions: expect.arrayContaining([
      expect.objectContaining({ id: deletionId, kind: "local", status: "verified" }),
      expect.objectContaining({ requestId: deletionId, kind: "vapi", status: "verified" }),
    ]) });
    expect(await (await audit(request(other.workspaceId))).json()).toEqual({ deletions: [] });
  });

  it("retains a recently active contact when its old independent conversations expire", async () => {
    const person = await makeContact(owner.workspaceId, old());
    await makeConversation(owner.workspaceId, person.id, "expired-call", old(), owner.assistantId);
    await makeConversation(owner.workspaceId, person.id, "new-call");
    provider.calls.set("expired-call", owner.assistantId);
    expect((await cron()).status).toBe(200);
    expect(await contactList(owner.workspaceId)).toMatchObject([{ id: person.id }]);
    expect(await callList(owner.workspaceId)).toMatchObject([{ externalId: "new-call" }]);
    expect(provider.calls.has("expired-call")).toBe(false);
  });

  it("expires copies past the default 90 days and keeps newer calls and their media", async () => {
    await db.update(workspaces).set({ retentionDays: sql`default` }).where(eq(workspaces.id, owner.workspaceId));
    expect(await db.select({ retentionDays: workspaces.retentionDays }).from(workspaces)
      .where(eq(workspaces.id, owner.workspaceId))).toEqual([{ retentionDays: 90 }]);
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
    for (const { days, callId, number } of [
      { days: 91, callId: "past-default-cutoff", number: phone },
      { days: 89, callId: "within-default-cutoff", number: "+447700900322" },
    ]) {
      const createdAt = daysAgo(days);
      const contact = await makeContact(owner.workspaceId, createdAt, number);
      const call = await makeConversation(owner.workspaceId, contact.id, callId, createdAt, owner.assistantId);
      await makeCallCopies(call, owner.assistantId);
      provider.calls.set(callId, owner.assistantId);
      provider.media.add(callId);
    }

    expect((await cron()).status).toBe(200);
    expect(await contactList(owner.workspaceId)).toMatchObject([{ phoneE164: "+447700900322" }]);
    expect(await callList(owner.workspaceId)).toMatchObject([{ externalId: "within-default-cutoff" }]);
    expect(await db.select().from(toolReceipts).where(eq(toolReceipts.workspaceId, owner.workspaceId)))
      .toMatchObject([{ callId: "within-default-cutoff" }]);
    expect(await db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, owner.workspaceId)))
      .toMatchObject([{ externalId: "within-default-cutoff" }]);
    expect(provider.deletes).toEqual(["past-default-cutoff"]);
    expect([...provider.calls.keys()]).toEqual(["within-default-cutoff"]);
    expect([...provider.media]).toEqual(["within-default-cutoff"]);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "verified", targetEncrypted: null }]);
  });
});

describe("provider deletion verification", () => {
  it("retries authorization and timeouts, recovers leased and lost deletes, and requires provider media to be absent", async () => {
    const person = await makeContact(owner.workspaceId);
    const id = "retry-call";
    await makeConversation(owner.workspaceId, person.id, id, new Date(), owner.assistantId);
    provider.calls.set(id, owner.assistantId);
    provider.media.add(id);
    let signedReads = 0;
    googleServer.use(http.get("https://signed.example/recording", () => {
      signedReads++;
      return new HttpResponse(null, { status: 403 });
    }));
    expect((await fetch("https://signed.example/recording")).status).toBe(403);
    expect(provider.media.has(id)).toBe(true);
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(202);

    provider.authFailure = true;
    expect((await cron()).status).toBe(200);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 1, errorCode: "vapi_authorization_failed" }]);
    expect(provider.deletes).toEqual([]);

    provider.authFailure = false;
    provider.slowRead = true;
    await retryNow(owner.workspaceId);
    expect((await cron()).status).toBe(200);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 2, errorCode: "vapi_request_failed" }]);
    expect(provider.deletes).toEqual([]);

    provider.slowRead = false;
    provider.lostDeleteReply = true;
    provider.pendingMediaRemoval = true;
    await db.update(deletionLog).set({ status: "processing", leaseUntil: expired, nextAttemptAt: null })
      .where(and(eq(deletionLog.workspaceId, owner.workspaceId), eq(deletionLog.kind, "vapi")));
    expect((await cron()).status).toBe(200);
    expect(provider.calls.has(id)).toBe(false);
    expect(provider.media.has(id)).toBe(true);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 3, verifiedAt: null }]);

    await retryNow(owner.workspaceId);
    expect((await cron()).status).toBe(200);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 4, errorCode: "vapi_media_unverified" }]);
    expect(provider.deletes).toEqual([id]);
    provider.media.delete(id);
    await retryNow(owner.workspaceId);
    expect((await cron()).status).toBe(200);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "verified", attempts: 5, errorCode: null, targetEncrypted: null }]);
    expect(provider.requests.filter(path => path.includes("recording"))).toHaveLength(10);
    expect(provider.deletes).toEqual([id]);
    expect(signedReads).toBe(1);
  });

  it("does not mutate records with mismatched ownership, while trusted historical ingress survives assistant replacement", async () => {
    const person = await makeContact(owner.workspaceId);
    await makeConversation(owner.workspaceId, person.id, "foreign-call", new Date(), owner.assistantId);
    await makeConversation(owner.workspaceId, person.id, "absent-call", new Date(), owner.assistantId);
    const older = await makeConversation(owner.workspaceId, person.id, "historical-call");
    await makeCallCopies(older, owner.assistantId);
    await db.update(assistantSyncs).set({ vapiAssistantId: "new-assistant-id" }).where(eq(assistantSyncs.workspaceId, owner.workspaceId));
    provider.calls.set("foreign-call", other.assistantId);
    provider.calls.set("historical-call", owner.assistantId);
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(202);
    expect((await cron()).status).toBe(200);
    expect(provider.deletes).toEqual(["historical-call"]);
    expect(provider.calls.get("foreign-call")).toBe(other.assistantId);
    expect(await providerTasks(owner.workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "manual", errorCode: "vapi_ownership_unverified" }),
      expect.objectContaining({ status: "manual", errorCode: "vapi_absence_unverified" }),
      expect.objectContaining({ status: "verified" }),
    ]));
  });
});

describe("Google scheduling", () => {
  it("scrubs an old Google event after a lost PATCH outcome and retains the active booking and user-managed fields", async () => {
    const person = await makeContact(owner.workspaceId, old());
    const result = await bookAppointment({
      workspaceId: owner.workspaceId, serviceId, contactId: person.id, notes: pii,
      start: slot(1, 10).toJSDate(), source: "admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected booked slot");
    const booking = result.appointment;
    const eventId = booking.googleEventId!;
    expect(google.events.get(eventId)?.description).toContain(pii);
    Object.assign(google.events.get(eventId)!, { location: "Dispatch room", status: "confirmed",
      attendees: [{ email: "dispatcher@example.com" }], reminders: { useDefault: true } });
    await db.update(appointments).set({ createdAt: old() }).where(eq(appointments.id, booking.id));
    google.losePatchResponse = true;
    expect((await cron()).status).toBe(200);
    expect(await contactList(owner.workspaceId)).toEqual([]);
    expect(await db.select().from(appointments).where(eq(appointments.id, booking.id))).toMatchObject([{
      startAt: booking.startAt, endAt: booking.endAt, blockedUntil: booking.blockedUntil, status: "booked", serviceId,
      googleEventId: eventId, contactId: null, notes: null, piiErasedAt: expect.any(Date),
    }]);
    expect(google.events.get(eventId)).toMatchObject({
      summary: "Appointment", description: "", location: "Dispatch room", status: "confirmed",
      attendees: [{ email: "dispatcher@example.com" }], reminders: { useDefault: true },
      start: { dateTime: booking.startAt.toISOString() }, end: { dateTime: booking.endAt.toISOString() },
    });
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "retryable", attempts: 1 }]);
    google.losePatchResponse = false;
    await retryNow(owner.workspaceId);
    expect((await cron()).status).toBe(200);
    expect(google.calls.filter(call => call.startsWith("patch"))).toEqual([`patch ${eventId}`]);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "verified", attempts: 2, targetEncrypted: null }]);
    expect(await bookAppointment({ workspaceId: owner.workspaceId, serviceId, start: booking.startAt, source: "admin" }))
      .toMatchObject({ ok: false, reason: "slot_taken" });
  });

  it.each(["hub", "Google"] as const)("checks an unmarked event moved by %s while its scrub is queued", async movedBy => {
    const person = await makeContact(owner.workspaceId);
    const booked = await bookAppointment({
      workspaceId: owner.workspaceId, serviceId, contactId: person.id, notes: pii,
      start: slot(1, 10).toJSDate(), source: "admin",
    });
    if (!booked.ok) throw new Error("Expected booked slot");
    const booking = booked.appointment;
    const event = google.events.get(booking.googleEventId!)!;
    Reflect.deleteProperty(event, "extendedProperties");
    const start = slot(1, 12).toJSDate();
    const end = slot(1, 13).toJSDate();
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(202);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "pending" }]);

    if (movedBy === "hub") {
      expect(await updateAppointmentStatus(owner.workspaceId, booking.id, "rescheduled", start)).toMatchObject({ ok: true });
    } else {
      event.start = { dateTime: start.toISOString() };
      event.end = { dateTime: end.toISOString() };
    }
    expect(event.description).toContain(pii);
    expect((await cron()).status).toBe(200);
    expect(await contactList(owner.workspaceId)).toEqual([]);
    expect(await db.select().from(appointments).where(eq(appointments.id, booking.id))).toMatchObject([{
      startAt: movedBy === "hub" ? start : booking.startAt,
      endAt: movedBy === "hub" ? end : booking.endAt,
      status: movedBy === "hub" ? "rescheduled" : "booked",
      googleEventId: booking.googleEventId, notes: null, contactId: null, piiErasedAt: expect.any(Date),
    }]);
    const remote = google.events.get(booking.googleEventId!)!;
    expect(remote.start.dateTime).toBe(start.toISOString());
    expect(remote.end.dateTime).toBe(end.toISOString());
    if (movedBy === "hub") {
      expect(remote).toMatchObject({ summary: "Appointment", description: "" });
      expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "verified", targetEncrypted: null }]);
    } else {
      expect(remote.description).toContain(pii);
      expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "manual", errorCode: "google_ownership_unverified" }]);
    }
  });

  it("redacts pending public booking snapshots before reconciliation while preserving the capacity and operation", async () => {
    const person = await makeContact(owner.workspaceId);
    const id = crypto.randomUUID();
    const eventId = id.replaceAll("-", "");
    const startAt = slot(1, 10).toJSDate();
    const endAt = slot(1, 11).toJSDate();
    const operation: CalendarOperation = { id, kind: "create", phase: "apply", previousStatus: null, nextStatus: "booked",
      timezone: "Europe/London", summary: personName, description: pii, intake: { address: pii },
      publicContact: { name: personName, phone, email } };
    await db.insert(appointments).values({
      id, workspaceId: owner.workspaceId, serviceId, startAt, endAt, blockedUntil: endAt, source: "form",
      googleEventId: eventId, googleCalendarId: "cal1", calendarOperation: operation, reconcileAt: expired, status: "pending", notes: pii,
    });
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(202);
    expect(await db.select().from(appointments)).toMatchObject([{ status: "pending", calendarOperation: {
      id, kind: "create", phase: "apply", previousStatus: null, nextStatus: "booked", timezone: "Europe/London", summary: "Appointment",
    }, notes: null }]);
    const response = await cron();
    expect(response.status).toBe(200);
    expect(await contactList(owner.workspaceId)).toEqual([]);
    expect(await db.select().from(jobs)).toEqual([]);
    expect(await db.select().from(notificationLog)).toEqual([]);
    expect(await db.select().from(appointments)).toMatchObject([{ status: "booked", calendarOperation: null, contactId: null, conversationId: null }]);
    expect(google.events.get(eventId)).toMatchObject({ summary: "Appointment", start: { dateTime: startAt.toISOString() } });
    expect(google.events.get(eventId)?.description).toBeUndefined();
  });

  it("leaves ambiguous Google mappings for review under a shared calendar", async () => {
    await db.insert(calendars).values({ workspaceId: other.workspaceId, googleCalendarId: "cal1" });
    const person = await makeContact(owner.workspaceId);
    const result = await bookAppointment({ workspaceId: owner.workspaceId, serviceId, contactId: person.id,
      start: slot(1, 10).toJSDate(), source: "admin", notes: pii });
    if (!result.ok) throw new Error("Expected booking");
    const { startAt, endAt, blockedUntil, googleEventId } = result.appointment;
    await db.insert(appointments).values({ workspaceId: other.workspaceId, startAt, endAt, blockedUntil,
      googleEventId, googleCalendarId: "cal1", source: "admin", notes: "Other workspace notes" });
    expect((await DELETE(request(owner.workspaceId, person.id))).status).toBe(202);
    expect((await cron()).status).toBe(200);
    expect(await contactList(owner.workspaceId)).toEqual([]);
    expect(await providerTasks(owner.workspaceId)).toMatchObject([{ status: "manual", errorCode: "google_ownership_unverified" }]);
    expect(google.events.get(googleEventId!)?.description).toContain(pii);
    expect(google.calls.some(call => call.startsWith("patch"))).toBe(false);
    expect(await db.select().from(appointments).where(eq(appointments.workspaceId, other.workspaceId)))
      .toMatchObject([{ notes: "Other workspace notes", piiErasedAt: null }]);
  });
});
