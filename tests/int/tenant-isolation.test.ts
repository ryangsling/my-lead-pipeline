import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assistantDefaults, saveAssistant } from "@/lib/agent/store";
import { db } from "@/lib/db/client";
import {
  appointments, assistants, assistantSyncs, calendars, contacts, conversations, deletionLog, embeds, integrations, jobs,
  messages, notificationChannels, notificationLog, offeredSlots, phoneNumberChanges, phoneNumbers, rateLimits,
  services, toolReceipts, urgentEvents, vapiAccounts, webhookEvents, workspaces,
} from "@/lib/db/schema";

const slugs = ["tenant-isolation-a", "tenant-isolation-b"];
const start = new Date("2030-01-01T10:00:00Z");
const end = new Date("2030-01-01T11:00:00Z");
const time = { startAt: start, endAt: end, blockedUntil: end, source: "form", status: "requested" };

async function seed(slug: string) {
  const [workspace] = await db.insert(workspaces).values({ name: slug, slug, webhookSecretEncrypted: "unused" }).returning();
  const workspaceId = workspace.id;
  const [assistant] = await db.insert(assistants).values({
    workspaceId, personaName: "Agent", firstMessage: "Hello", systemPrompt: "Answer calls",
  }).returning();
  const [contact] = await db.insert(contacts).values({ workspaceId, name: "Ada" }).returning();
  const [service] = await db.insert(services).values({ workspaceId, name: "Visit", durationMin: 60 }).returning();
  const [conversation] = await db.insert(conversations).values({
    workspaceId, contactId: contact.id, channel: "phone", externalId: "shared-call-id",
  }).returning();
  const [appointment] = await db.insert(appointments).values({
    workspaceId, contactId: contact.id, serviceId: service.id, conversationId: conversation.id, ...time,
  }).returning();
  const [channel] = await db.insert(notificationChannels).values({ workspaceId, type: "telegram", target: slug }).returning();
  return { workspaceId, assistantId: assistant.id, contactId: contact.id, serviceId: service.id,
    conversationId: conversation.id, appointmentId: appointment.id, channelId: channel.id };
}

let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await db.delete(workspaces).where(inArray(workspaces.slug, slugs));
  [a, b] = await Promise.all(slugs.map(seed));
});

afterAll(async () => {
  await db.delete(workspaces).where(inArray(workspaces.slug, slugs));
});

describe("tenant relationship constraints", () => {
  it("rejects a cross-workspace reference on every tenant-owned relationship", async () => {
    const { workspaceId } = a;
    const unreserved = { ...time, status: "cancelled" };
    const [request] = await db.insert(deletionLog).values({ workspaceId: b.workspaceId, kind: "local",
      subjectKey: "contact-test", reason: "contact_request", status: "verified" }).returning();
    const refs = [
      db.insert(assistantSyncs).values({ workspaceId, assistantId: b.assistantId }),
      db.insert(phoneNumbers).values({ workspaceId, assistantId: b.assistantId, vapiPhoneNumberId: "wrong", e164: "+12025550123" }),
      db.insert(phoneNumberChanges).values({
        workspaceId, assistantId: b.assistantId, phoneNumberId: crypto.randomUUID(), vapiPhoneNumberId: "wrong", vapiAssistantId: "remote",
      }),
      db.insert(conversations).values({ workspaceId, contactId: b.contactId, channel: "phone" }),
      db.insert(appointments).values({ workspaceId, contactId: b.contactId, ...unreserved }),
      db.insert(appointments).values({ workspaceId, serviceId: b.serviceId, ...unreserved }),
      db.insert(appointments).values({ workspaceId, conversationId: b.conversationId, ...unreserved }),
      db.insert(messages).values({ workspaceId, conversationId: b.conversationId, role: "assistant" }),
      db.insert(notificationLog).values({ workspaceId, channelId: b.channelId, event: "test", dedupeKey: "wrong" }),
      db.insert(notificationLog).values({
        workspaceId, channelId: a.channelId, urgentConversationId: b.conversationId, event: "urgent_callback", dedupeKey: "wrong",
      }),
      db.insert(offeredSlots).values({ workspaceId, conversationId: b.conversationId, serviceId: a.serviceId, start, expiresAt: end }),
      db.insert(offeredSlots).values({ workspaceId, conversationId: a.conversationId, serviceId: b.serviceId, start, expiresAt: end }),
      db.insert(jobs).values({ workspaceId, contactId: b.contactId, timezone: "UTC" }),
      db.insert(jobs).values({ workspaceId, conversationId: b.conversationId, timezone: "UTC" }),
      db.insert(jobs).values({ workspaceId, appointmentId: b.appointmentId, timezone: "UTC" }),
      db.insert(urgentEvents).values({ workspaceId, conversationId: b.conversationId }),
      db.insert(deletionLog).values({ workspaceId, requestId: request.id, kind: "vapi", subjectKey: "call-test",
        reason: "contact_request", status: "pending" }),
      db.update(appointments).set({ contactId: b.contactId }).where(eq(appointments.id, a.appointmentId)),
    ];
    for (const invalid of refs) await expect(invalid).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await db.select({ contactId: appointments.contactId }).from(appointments)
      .where(eq(appointments.id, a.appointmentId))).toEqual([{ contactId: a.contactId }]);
  });

  it("updates the assistant draft in the selected workspace", async () => {
    const [original] = await db.select().from(assistants).where(eq(assistants.workspaceId, b.workspaceId));
    const { structuredSchema: structuredFields, ...defaults } = assistantDefaults("Updated tenant");
    const input = { ...defaults, structuredFields, voiceId: "voice-test" };
    expect(await saveAssistant(a.workspaceId, input)).toMatchObject({
      id: a.assistantId, workspaceId: a.workspaceId, personaName: input.personaName,
    });
    expect(await db.select().from(assistants).where(eq(assistants.workspaceId, b.workspaceId))).toEqual([original]);
  });

  it("requires workspace identity on replayable inbox rows", async () => {
    const base = { source: "vapi", externalId: "shared-call-id", eventType: "end-of-call-report", raw: {} };
    await expect(db.insert(webhookEvents).values(base)).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(webhookEvents).values({ ...base, workspaceId: a.workspaceId, status: "unscoped" }))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("clears nullable links and cascades dependent messages when parents are removed", async () => {
    const { workspaceId, conversationId, contactId, serviceId, appointmentId } = b;
    const [message] = await db.insert(messages).values({ workspaceId, conversationId, role: "user" }).returning();
    await db.delete(contacts).where(eq(contacts.id, contactId));
    await db.delete(services).where(eq(services.id, serviceId));
    expect(await db.select().from(conversations).where(eq(conversations.id, conversationId)))
      .toMatchObject([{ workspaceId, contactId: null }]);
    await db.delete(conversations).where(eq(conversations.id, conversationId));
    expect(await db.select().from(appointments).where(eq(appointments.id, appointmentId)))
      .toMatchObject([{ workspaceId, contactId: null, serviceId: null, conversationId: null }]);
    expect(await db.select().from(messages).where(eq(messages.id, message.id))).toEqual([]);
  });
});

describe("database access as anon", () => {
  it("reads zero rows from every app table under RLS despite SELECT grants", async () => {
    const { workspaceId, assistantId, contactId, serviceId, conversationId, appointmentId, channelId } = a;
    const rollback = new Error("Discard anon test role and grants");
    await expect(db.transaction(async tx => {
      const [account] = await tx.insert(vapiAccounts).values({
        label: "Shared test account", ownerName: "Operator", credentialsEncrypted: "unused", order: 1,
      }).returning();
      await tx.insert(assistantSyncs).values({ workspaceId, assistantId, vapiAccountId: account.id });
      const [phone] = await tx.insert(phoneNumbers).values({
        workspaceId, assistantId, vapiAccountId: account.id, vapiPhoneNumberId: "anon-test", e164: "+12025550123",
      }).returning();
      await tx.insert(phoneNumberChanges).values({
        workspaceId, assistantId, phoneNumberId: phone.id, vapiPhoneNumberId: phone.vapiPhoneNumberId, vapiAssistantId: "remote",
      });
      await tx.insert(calendars).values({ workspaceId });
      await tx.insert(deletionLog).values({ workspaceId, kind: "local", subjectKey: "anon-audit-test",
        reason: "contact_request", status: "verified" });
      await tx.insert(embeds).values({ workspaceId, publicKey: "anon-test-key" });
      await tx.insert(integrations).values({ provider: "test-anon" });
      await tx.insert(jobs).values({ workspaceId, contactId, conversationId, appointmentId, timezone: "UTC" });
      await tx.insert(messages).values({ workspaceId, conversationId, role: "user" });
      await tx.insert(notificationLog).values({ workspaceId, channelId, event: "test", dedupeKey: "anon-test" });
      await tx.insert(offeredSlots).values({ workspaceId, conversationId, serviceId, start, expiresAt: end });
      await tx.insert(rateLimits).values({ key: "anon-test-key", windowStart: start });
      await tx.insert(toolReceipts).values({ workspaceId, callId: "shared-call-id", toolCallId: "tc1", name: "test" });
      await tx.insert(urgentEvents).values({ workspaceId, conversationId });
      await tx.insert(webhookEvents).values({ workspaceId, source: "vapi", eventType: "end-of-call-report", externalId: "shared-call-id", raw: {} });

      const tables = await tx.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
      expect(tables.map(({ tablename }) => tablename).sort()).toEqual([
        "appointments", "assistant_syncs", "assistants", "calendars", "contacts", "conversations", "deletion_log", "embeds", "integrations",
        "jobs", "messages", "notification_channels", "notification_log", "offered_slots", "phone_number_changes", "phone_numbers",
        "rate_limits", "services", "tool_receipts", "urgent_events", "vapi_accounts", "webhook_events", "workspaces",
      ]);
      const readRows = (table: string) => tx.execute<{ count: number }>(sql`select count(*)::int as count from public.${sql.identifier(table)}`);
      for (const { tablename } of tables) expect((await readRows(tablename))[0].count, tablename).toBeGreaterThan(0);

      await tx.execute(sql`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin nosuperuser nobypassrls;
        end if;
      end $$`);
      await tx.execute(sql`grant usage on schema public to anon`);
      await tx.execute(sql`grant select on all tables in schema public to anon`);
      await tx.execute(sql`set local role anon`);
      expect(await tx.execute(sql`select current_user as role`)).toMatchObject([{ role: "anon" }]);
      for (const { tablename } of tables) expect((await readRows(tablename))[0].count, tablename).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
