import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { listAppointments } from "@/lib/booking/list";
import { getContact, listConversations } from "@/lib/crm/list";
import { db } from "@/lib/db/client";
import {
  appointments, assistants, assistantSyncs, calendars, conversations, messages, notificationChannels,
  notificationLog, services, webhookEvents, workspaces,
} from "@/lib/db/schema";
import { listLog } from "@/lib/notifications/channels";
import { enqueueBookingNew, notifyCallEnded } from "@/lib/notifications/events";
import { deliver, deliverNotifications } from "@/lib/notifications/send";

const sendMessage = vi.hoisted(() => vi.fn(async () => "accepted"));
vi.mock("@/lib/notifications/transport", () => ({
  prepareDelivery: async (_workspaceId: string, channel: { type: string; target: string }) =>
    ({ ...channel, kind: "telegram", fingerprint: "test-fingerprint" }),
  sendMessage,
}));

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("migrations", () => {
  it("upgrades legacy rows, preserving known events and holding unidentified active bookings for review", async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    const migrations = readMigrationFiles({ migrationsFolder });
    const upgrade = migrations.findIndex(m => m.sql.some(s => s.includes('ADD COLUMN "calendar_operation"')));
    expect(upgrade).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, upgrade)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    const [ws] = await db.insert(workspaces).values({
      slug: "legacy", name: "Legacy", webhookSecretEncrypted: "unused",
    }).returning();
    await db.execute(sql`INSERT INTO calendars (workspace_id, google_calendar_id) VALUES (${ws.id}, 'original')`);
    await db.execute(sql`INSERT INTO appointments(workspace_id, start_at, end_at, blocked_until, status, source, google_event_id) VALUES
      (${ws.id}, '2027-01-01 10:00Z', '2027-01-01 11:00Z', '2027-01-01 11:00Z', 'booked', 'form', 'legacy-google-id'),
      (${ws.id}, '2027-01-01 12:00Z', '2027-01-01 13:00Z', '2027-01-01 13:00Z', 'booked', 'form', NULL),
      (${ws.id}, '2027-01-01 12:00Z', '2027-01-01 13:00Z', '2027-01-01 13:00Z', 'cancelled', 'form', NULL)`);
    for (const statement of migrations[upgrade].sql) await db.execute(sql.raw(statement));
    const rows = await db.select({ status: appointments.status, googleEventId: appointments.googleEventId,
      googleCalendarId: appointments.googleCalendarId, calendarOperation: appointments.calendarOperation,
      startAt: appointments.startAt, endAt: appointments.endAt, blockedUntil: appointments.blockedUntil,
    }).from(appointments);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "booked", googleEventId: "legacy-google-id", googleCalendarId: "original" }),
      expect.objectContaining({ status: "needs_review", googleEventId: null, calendarOperation: null }),
      expect.objectContaining({ status: "cancelled", googleEventId: null }),
    ]));
    const held = rows.find(r => r.status === "needs_review")!;
    await expect(db.execute(sql`insert into appointments (workspace_id, source, start_at, end_at, blocked_until)
      values (${ws.id}, 'form', ${held.startAt.toISOString()}, ${held.endAt.toISOString()}, ${held.blockedUntil.toISOString()})`))
      .rejects.toMatchObject({ cause: { code: "23P01" } });

    for (const migration of migrations.slice(upgrade + 1)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    expect(await db.select().from(calendars)).toMatchObject([
      { workspaceId: ws.id, googleCalendarId: "original", publicBookingRequestOnly: false },
    ]);
    const preserved = await db.select({ createdAt: appointments.createdAt, startAt: appointments.startAt }).from(appointments);
    expect(preserved.every(row => row.createdAt.getTime() <= row.startAt.getTime())).toBe(true);
  });

  it("preserves legacy raw receipts and does not replay legacy notifications of unknown acceptance", async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    const migrations = readMigrationFiles({ migrationsFolder });
    const upgrade = migrations.findIndex((migration) => migration.sql.some((statement) => statement.includes("webhook_events_workspace_source_external")));
    expect(upgrade).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, upgrade)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    const [ws] = await db.insert(workspaces).values({ slug: "legacy-inbox", name: "Legacy inbox", webhookSecretEncrypted: "unused" }).returning();
    const raw = { message: { call: { id: "legacy", assistantId: "untrusted" } } };
    await db.execute(sql`insert into webhook_events (source, external_id, event_type, raw)
      values ('vapi', 'legacy', 'end-of-call-report', ${JSON.stringify(raw)}::jsonb)`);
    await db.execute(sql`insert into notification_log (workspace_id, event, dedupe_key, status)
      values (${ws.id}, 'booking_new', 'pending-legacy', 'pending'), (${ws.id}, 'booking_new', 'sent-legacy', 'sent')`);
    for (const statement of migrations[upgrade].sql) await db.execute(sql.raw(statement));
    expect(await db.select({ workspaceId: webhookEvents.workspaceId, status: webhookEvents.status, raw: webhookEvents.raw,
      nextAttemptAt: webhookEvents.nextAttemptAt,
    }).from(webhookEvents)).toMatchObject([{ workspaceId: null, status: "unscoped", raw, nextAttemptAt: null }]);
    expect(await db.select().from(notificationLog)).toEqual(expect.arrayContaining([
      expect.objectContaining({ dedupeKey: "pending-legacy", status: "uncertain", uncertainAttempt: true, nextAttemptAt: null }),
      expect.objectContaining({ dedupeKey: "sent-legacy", status: "sent" }),
    ]));
    await db.execute(sql`insert into webhook_events (workspace_id, source, external_id, event_type, raw) values
      (${ws.id}, 'vapi', 'authenticated:ended', 'status-update', '{"message":{"call":{"id":"authenticated","assistantId":"historical-assistant"}}}'),
      (${ws.id}, 'vapi', 'mismatch', 'end-of-call-report', '{"message":{"call":{"id":"different-call","assistantId":"foreign-assistant"}}}')`);
    for (const migration of migrations.slice(upgrade + 1)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    expect(await db.select().from(webhookEvents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "authenticated:ended", callId: "authenticated", vapiAssistantId: "historical-assistant" }),
      expect.objectContaining({ externalId: "mismatch", callId: null, vapiAssistantId: null }),
      expect.objectContaining({ externalId: "legacy", callId: null, vapiAssistantId: null }),
    ]));
  });

  it("keeps inconsistent legacy child records out of owner alerts and blocks migration until repaired", async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    const migrations = readMigrationFiles({ migrationsFolder });
    const upgrade = migrations.findIndex(m => m.sql.some(s => s.includes("messages_workspace_conversation_fk")));
    expect(upgrade).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, upgrade)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    const [a, b] = await db.insert(workspaces).values([
      { slug: "legacy-owner", name: "Owner", webhookSecretEncrypted: "unused" },
      { slug: "legacy-other", name: "Other", webhookSecretEncrypted: "unused" },
    ]).returning();
    const [owner, foreign] = await db.execute<{ id: string }>(sql`insert into contacts (workspace_id, name, phone_e164)
      values (${a.id}, 'Owner Contact', null), (${b.id}, 'Foreign Contact', '+12025550123') returning id`);
    const [service] = await db.insert(services).values({ workspaceId: b.id, name: "Foreign Service", durationMin: 60 }).returning();
    const [foreignChannel] = await db.insert(notificationChannels).values([
      { workspaceId: b.id, type: "telegram", target: "foreign-recipient", events: ["booking_new"] },
      { workspaceId: a.id, type: "telegram", target: "owner-recipient", events: ["booking_new", "call_no_booking"] },
    ]).returning();
    const [call] = await db.execute<{ id: string }>(sql`insert into conversations (workspace_id, contact_id, channel, recording_url)
      values (${a.id}, ${foreign.id}, 'phone', 'https://recording.example/legacy.wav') returning id`);
    const [appointment] = await db.execute<{ id: string }>(sql`insert into appointments
      (workspace_id, service_id, contact_id, start_at, end_at, blocked_until, source, status) values
      (${a.id}, ${service.id}, ${foreign.id}, '2030-01-01 10:00Z', '2030-01-01 11:00Z', '2030-01-01 11:00Z', 'form', 'requested'),
      (${a.id}, ${service.id}, ${owner.id}, '2030-01-01 10:00Z', '2030-01-01 11:00Z', '2030-01-01 11:00Z', 'form', 'cancelled') returning id`);
    const [log] = await db.insert(notificationLog).values({
      workspaceId: a.id, channelId: foreignChannel.id, event: "booking_new", dedupeKey: "legacy",
    }).returning();
    const [assistant] = await db.insert(assistants).values({
      workspaceId: b.id, personaName: "Agent", firstMessage: "Hello", systemPrompt: "Answer calls",
    }).returning();
    await db.execute(sql`insert into assistant_syncs (assistant_id, vapi_assistant_id) values (${assistant.id}, 'old-provider-id')`);
    await db.execute(sql`insert into messages (conversation_id, role, content) values (${call.id}, 'user', 'Legacy transcript')`);

    const preflight = sql.raw(readFileSync(new URL("../../scripts/check-tenant-relationships.sql", import.meta.url), "utf8"));
    expect(await db.execute(preflight)).toHaveLength(5);
    expect(await listConversations(a.id)).toMatchObject([{ id: call.id, contactName: null, contactPhone: null }]);
    expect(await listAppointments(a.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: appointment.id, contactName: null, contactPhone: null, service: null }),
    ]));
    expect(await listLog(a.id)).toMatchObject([{ id: log.id, target: null }]);
    expect(await deliver({ workspaceId: a.id, id: log.id }, { once: true })).toMatchObject({ ok: false });
    expect(sendMessage).not.toHaveBeenCalled();

    // Exercise the current notification query against the pre-isolation relationships.
    await db.execute(sql`alter table appointments add column pii_erased_at timestamptz`);
    await notifyCallEnded(a.id, call.id);
    await deliverNotifications(await enqueueBookingNew(a.id, appointment.id));
    expect(sendMessage.mock.calls).toEqual([
      [expect.objectContaining({ target: "owner-recipient" }), {
        subject: "Call ended without a booking", body: expect.stringContaining("/w/legacy-owner/conversations/"),
      }, expect.anything()],
      [expect.objectContaining({ target: "owner-recipient" }), {
        subject: "New booking", body: expect.stringContaining("/w/legacy-owner/appointments"),
      }, expect.anything()],
    ]);
    for (const row of await db.select().from(notificationLog).where(eq(notificationLog.status, "sent"))) {
      expect(row.workspaceId).toBe(a.id);
      expect(row.payload).not.toHaveProperty("name");
      expect(row.payload).not.toHaveProperty("phone");
      expect(row.payload).not.toHaveProperty("service");
    }
    await db.execute(sql`alter table appointments drop column pii_erased_at`);
    const apply = () => db.transaction(async tx => {
      for (const statement of migrations[upgrade].sql) await tx.execute(sql.raw(statement));
    });
    await expect(apply()).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await db.execute(preflight)).toHaveLength(5);
    expect(await db.select({ contactId: appointments.contactId, serviceId: appointments.serviceId }).from(appointments)
      .where(eq(appointments.id, appointment.id))).toEqual([{ contactId: foreign.id, serviceId: service.id }]);
    expect(await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public'
      and table_name = 'messages' and column_name = 'workspace_id'`)).toEqual([]);

    await db.update(appointments).set({ serviceId: null }).where(eq(appointments.workspaceId, a.id));
    await db.update(appointments).set({ contactId: null }).where(eq(appointments.id, appointment.id));
    await db.update(conversations).set({ contactId: null }).where(eq(conversations.id, call.id));
    await db.update(notificationLog).set({ channelId: null }).where(eq(notificationLog.id, log.id));
    expect(await db.execute(preflight)).toEqual([]);
    await apply();
    expect(await db.select().from(messages)).toMatchObject([{ workspaceId: a.id, conversationId: call.id, content: "Legacy transcript" }]);
    expect(await db.select().from(assistantSyncs)).toMatchObject([{ workspaceId: b.id, assistantId: assistant.id, vapiAssistantId: "old-provider-id" }]);
    for (const migration of migrations.slice(upgrade + 1)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    expect(await db.select().from(conversations).where(eq(conversations.id, call.id))).toMatchObject([
      { recordingUrl: "https://recording.example/legacy.wav", recordingConsentAt: null },
    ]);
    expect((await getContact(a.id, owner.id))?.appointments).toMatchObject([{ service: null }]);
  });

  it("apply to an empty database twice without error", async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);

    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });

    expect(await db.select().from(workspaces)).toEqual([]);
  });
});
