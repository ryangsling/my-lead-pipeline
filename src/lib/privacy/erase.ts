import { and, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { erasedAppointmentTitle } from "@/lib/booking/event";
import { normalizePhone } from "@/lib/crm/contacts";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import {
  appointments, contacts, conversations, deletionLog, jobs, notificationLog, offeredSlots, toolReceipts, webhookEvents, workspaces,
} from "@/lib/db/schema";
import { lockPrivacy, privacyKey, type PrivacyTransaction } from "./scope";
import type { GoogleEraseTarget, VapiEraseTarget } from "./targets";

type Reason = typeof deletionLog.$inferInsert["reason"];
type Receipts = (typeof webhookEvents.$inferSelect)[];
type Contact = Pick<typeof contacts.$inferSelect, "phoneE164" | "email">;
const dayMs = 86_400_000;
const batchSize = 100;

function callIdOf(row: Receipts[number]) {
  if (row.callId) return row.callId;
  if (row.eventType === "end-of-call-report") return row.externalId;
  const i = row.externalId.lastIndexOf(":");
  return i > 0 ? row.externalId.slice(0, i) : null;
}

function matchesContact(raw: unknown, contact: Contact, country: string) {
  const value = raw as { message?: {
    call?: { customer?: { number?: string; email?: string } };
    artifact?: { structuredOutputs?: Record<string, { result?: { phone?: string; email?: string } }> };
  } } | null;
  const customer = value?.message?.call?.customer;
  const fields = Object.values(value?.message?.artifact?.structuredOutputs ?? {}).flatMap(output => {
    const result = output?.result;
    return result && typeof result === "object" && !Array.isArray(result) ? [result] : [];
  });
  const primaryPhone = typeof customer?.number === "string" ? normalizePhone(customer.number, country) : null;
  const phones = primaryPhone ? [primaryPhone] : fields.map(result => result.phone)
    .flatMap(phone => typeof phone === "string" ? normalizePhone(phone, country) ?? [] : []);
  if (contact.phoneE164 && phones.includes(contact.phoneE164)) return true;
  if (contact.phoneE164 && phones.length) return false;
  return Boolean(contact.email && [customer?.email, ...fields.map(result => result.email)].some(email =>
    typeof email === "string" && email.trim().toLowerCase() === contact.email?.trim().toLowerCase()));
}

async function localAudit(tx: PrivacyTransaction, workspaceId: string, subject: string, reason: Reason, now: Date) {
  const subjectKey = privacyKey(workspaceId, "local", subject);
  const [added] = await tx.insert(deletionLog).values({
    workspaceId, kind: "local", subjectKey, reason, status: "verified", verifiedAt: now,
  }).onConflictDoNothing().returning({ id: deletionLog.id });
  if (added) return added.id;
  const [existing] = await tx.select({ id: deletionLog.id }).from(deletionLog)
    .where(and(eq(deletionLog.workspaceId, workspaceId), eq(deletionLog.kind, "local"), eq(deletionLog.subjectKey, subjectKey)));
  return existing.id;
}

async function eraseWorkspace(
  workspaceId: string, reason: Reason, now: Date, selectedContactId?: string,
) {
  return db.transaction(async tx => {
    await lockPrivacy(tx, workspaceId, true);
    const [workspace] = await tx.select({ country: workspaces.country, retentionDays: workspaces.retentionDays }).from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!workspace) return null;
    const cutoff = new Date(now.getTime() - Math.max(1, workspace.retentionDays) * dayMs);
    const cutoffSql = sql`${cutoff.toISOString()}::timestamptz`;
    const oldConversation = lte(sql`coalesce(${conversations.endedAt}, ${conversations.lastActivityAt}, ${conversations.startedAt}, ${conversations.createdAt})`, cutoffSql);
    const contactScope = and(eq(contacts.workspaceId, workspaceId), selectedContactId
      ? eq(contacts.id, selectedContactId)
      : and(
        lte(sql`coalesce(${contacts.lastSeenAt}, ${contacts.createdAt})`, cutoffSql),
        sql`not exists (select 1 from conversations as recent where recent.workspace_id = ${workspaceId}
          and recent.contact_id = ${contacts.id} and coalesce(recent.ended_at, recent.last_activity_at, recent.started_at, recent.created_at) > ${cutoffSql})`,
        sql`not exists (select 1 from appointments as recent where recent.workspace_id = ${workspaceId}
          and recent.contact_id = ${contacts.id} and least(recent.created_at, recent.start_at) > ${cutoffSql})`,
        sql`not exists (select 1 from jobs as recent where recent.workspace_id = ${workspaceId}
          and recent.contact_id = ${contacts.id} and recent.created_at > ${cutoffSql})`,
      ));
    const people = await tx.select().from(contacts).where(contactScope).orderBy(contacts.createdAt).limit(batchSize);
    if (selectedContactId && !people.length) return null;
    const contactIds = people.map(person => person.id);
    const relatedJobs = contactIds.length ? await tx.select({
      conversationId: jobs.conversationId, appointmentId: jobs.appointmentId,
    }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), inArray(jobs.contactId, contactIds))) : [];
    const jobCalls = relatedJobs.flatMap(job => job.conversationId ?? []);
    const jobBookings = relatedJobs.flatMap(job => job.appointmentId ?? []);

    // Raw receipts can still be waiting for their first ingestion and have no CRM link.
    const candidateReceipts = selectedContactId ? await tx.select().from(webhookEvents)
      .where(and(eq(webhookEvents.workspaceId, workspaceId), eq(webhookEvents.source, "vapi")))
      : await tx.select().from(webhookEvents)
        .where(and(eq(webhookEvents.workspaceId, workspaceId), eq(webhookEvents.source, "vapi"), lte(webhookEvents.receivedAt, cutoff)))
        .orderBy(webhookEvents.receivedAt).limit(batchSize);
    const receipts = selectedContactId
      ? candidateReceipts.filter(row => matchesContact(row.raw, people[0], workspace.country))
      : candidateReceipts;
    const calls = new Map<string, Set<string>>();
    const addCall = (id: string | null, assistant: string | null) => {
      if (!id) return;
      if (!calls.has(id)) calls.set(id, new Set());
      if (assistant) calls.get(id)!.add(assistant);
    };
    for (const receipt of receipts) addCall(callIdOf(receipt), receipt.vapiAssistantId);

    if (!selectedContactId) {
      const orphanReceipts = await tx.selectDistinct({ callId: toolReceipts.callId }).from(toolReceipts)
        .where(and(eq(toolReceipts.workspaceId, workspaceId), lte(toolReceipts.createdAt, cutoff),
          sql`not exists (select 1 from conversations c where c.workspace_id = ${workspaceId}
            and c.external_id = ${toolReceipts.callId})`)).limit(batchSize);
      for (const receipt of orphanReceipts) addCall(receipt.callId, null);
    }

    const callWhere = and(eq(conversations.workspaceId, workspaceId), or(
      contactIds.length ? inArray(conversations.contactId, contactIds) : undefined,
      jobCalls.length ? inArray(conversations.id, jobCalls) : undefined,
      calls.size ? inArray(conversations.externalId, [...calls.keys()]) : undefined,
      selectedContactId ? undefined : oldConversation,
    ));
    const callsToErase = selectedContactId || contactIds.length || calls.size
      ? await tx.select().from(conversations).where(callWhere)
      : await tx.select().from(conversations).where(callWhere)
        .orderBy(sql`coalesce(${conversations.endedAt}, ${conversations.lastActivityAt}, ${conversations.startedAt}, ${conversations.createdAt})`)
        .limit(batchSize);
    for (const call of callsToErase) {
      if (call.channel === "phone" || call.channel === "web_voice") addCall(call.externalId, call.vapiAssistantId);
    }
    const conversationIds = callsToErase.map(call => call.id);
    const allReceipts = calls.size ? await tx.select({
      id: webhookEvents.id, callId: webhookEvents.callId, eventType: webhookEvents.eventType, externalId: webhookEvents.externalId,
      vapiAssistantId: webhookEvents.vapiAssistantId,
    }).from(webhookEvents).where(and(eq(webhookEvents.workspaceId, workspaceId), eq(webhookEvents.source, "vapi"), or(
      inArray(webhookEvents.callId, [...calls.keys()]),
      and(isNull(webhookEvents.callId), or(
        inArray(webhookEvents.externalId, [...calls.keys()]),
        and(ne(webhookEvents.eventType, "end-of-call-report"),
          sql`regexp_replace(${webhookEvents.externalId}, ':[^:]*$', '') in (${sql.join([...calls.keys()].map(id => sql`${id}`), sql`, `)})`),
      )),
    ))) : [];
    for (const row of allReceipts) addCall(row.callId ?? (row.eventType === "end-of-call-report"
      ? row.externalId : row.externalId.slice(0, Math.max(0, row.externalId.lastIndexOf(":")))), row.vapiAssistantId);
    const receiptIds = [...new Set([...receipts, ...allReceipts].map(row => row.id))];

    // A pending public booking may contain the contact details before it has any foreign key.
    const pendingPublic = selectedContactId ? await tx.select({ id: appointments.id, operation: appointments.calendarOperation })
      .from(appointments).where(and(eq(appointments.workspaceId, workspaceId), isNull(appointments.piiErasedAt),
        sql`${appointments.calendarOperation}->'publicContact' is not null`)).for("update") : [];
    const pendingMatches = pendingPublic.filter(({ operation }) => {
      const person = operation?.publicContact;
      return person && matchesContact({ message: { call: { customer: { number: person.phone, email: person.email } } } }, people[0], workspace.country);
    }).map(row => row.id);
    const appointmentWhere = and(eq(appointments.workspaceId, workspaceId), isNull(appointments.piiErasedAt), or(
      contactIds.length ? inArray(appointments.contactId, contactIds) : undefined,
      conversationIds.length ? inArray(appointments.conversationId, conversationIds) : undefined,
      jobBookings.length ? inArray(appointments.id, jobBookings) : undefined,
      pendingMatches.length ? inArray(appointments.id, pendingMatches) : undefined,
      selectedContactId ? undefined : lte(sql`least(${appointments.createdAt}, ${appointments.startAt})`, cutoffSql),
    ));
    const bookings = await tx.select().from(appointments).where(appointmentWhere).orderBy(appointments.createdAt).for("update");
    const bookingIds = bookings.map(booking => booking.id);
    const dedupeKeys = [
      ...conversationIds.flatMap(id => ["call_no_booking", "lead_captured", "urgent_callback", "urgent_callback_escalation", "form_submitted"].map(event => `${event}:${id}`)),
      ...bookingIds.flatMap(id => ["booking_new", "booking_cancelled"].map(event => `${event}:${id}`)),
    ];
    const expiredLogs = selectedContactId ? [] : await tx.select({ id: notificationLog.id }).from(notificationLog)
      .where(and(eq(notificationLog.workspaceId, workspaceId), lte(notificationLog.createdAt, cutoff)))
      .orderBy(notificationLog.createdAt).limit(batchSize);
    if (dedupeKeys.length || expiredLogs.length || conversationIds.length) await tx.delete(notificationLog)
      .where(and(eq(notificationLog.workspaceId, workspaceId), or(
        dedupeKeys.length ? inArray(notificationLog.dedupeKey, dedupeKeys) : undefined,
        expiredLogs.length ? inArray(notificationLog.id, expiredLogs.map(row => row.id)) : undefined,
        conversationIds.length ? inArray(notificationLog.urgentConversationId, conversationIds) : undefined,
      )));
    if (!selectedContactId) await tx.delete(offeredSlots).where(and(eq(offeredSlots.workspaceId, workspaceId), lte(offeredSlots.expiresAt, now)));
    const jobLinks = or(
      contactIds.length ? inArray(jobs.contactId, contactIds) : undefined,
      conversationIds.length ? inArray(jobs.conversationId, conversationIds) : undefined,
      bookingIds.length ? inArray(jobs.appointmentId, bookingIds) : undefined,
      selectedContactId ? undefined : lte(jobs.createdAt, cutoff),
    );
    const erasedJobs = jobLinks ? await tx.delete(jobs).where(and(eq(jobs.workspaceId, workspaceId), jobLinks))
      .returning({ id: jobs.id }) : [];

    if (!contactIds.length && !conversationIds.length && !receiptIds.length && !calls.size && !bookingIds.length && !expiredLogs.length && !erasedJobs.length) return null;
    const requestId = await localAudit(tx, workspaceId, selectedContactId ?? crypto.randomUUID(), reason, now);

    for (const booking of bookings) {
      const { id, calendarOperation: operation, googleEventId, googleCalendarId } = booking;
      const cleanOperation = operation && {
        id: operation.id, kind: operation.kind, phase: operation.phase, timezone: operation.timezone,
        previousStatus: operation.previousStatus, nextStatus: operation.nextStatus, summary: erasedAppointmentTitle,
      };
      await tx.update(appointments).set({
        contactId: null, conversationId: null, notes: null, calendarOperation: cleanOperation, piiErasedAt: now,
      }).where(and(eq(appointments.workspaceId, workspaceId), eq(appointments.id, id)));
      if (!googleEventId && booking.status !== "needs_review") continue;
      const target: GoogleEraseTarget | null = googleEventId && googleCalendarId
        ? {
          appointmentId: id, eventId: googleEventId, calendarId: googleCalendarId,
          periods: [{ start: booking.startAt.toISOString(), end: booking.endAt.toISOString() },
            ...(booking.targetStart && booking.targetEnd
              ? [{ start: booking.targetStart.toISOString(), end: booking.targetEnd.toISOString() }] : [])],
        } : null;
      await tx.insert(deletionLog).values({
        workspaceId, requestId, kind: "google", subjectKey: privacyKey(workspaceId, "google", id), reason,
        status: target ? "pending" : "manual", nextAttemptAt: target ? now : null,
        targetEncrypted: target ? encrypt(JSON.stringify(target)) : encrypt(JSON.stringify({ appointmentId: id })),
        errorCode: target ? null : "google_mapping_missing",
      }).onConflictDoNothing();
    }
    for (const [callId, assistantIds] of calls) {
      const target: VapiEraseTarget = { callId, assistantIds: [...assistantIds] };
      await tx.insert(deletionLog).values({
        workspaceId, requestId, kind: "vapi", subjectKey: privacyKey(workspaceId, "vapi", callId), reason, status: "pending",
        targetEncrypted: encrypt(JSON.stringify(target)), nextAttemptAt: now,
      }).onConflictDoNothing();
    }
    if (calls.size) await tx.delete(toolReceipts)
      .where(and(eq(toolReceipts.workspaceId, workspaceId), inArray(toolReceipts.callId, [...calls.keys()])));
    if (receiptIds.length) await tx.delete(webhookEvents).where(and(eq(webhookEvents.workspaceId, workspaceId), inArray(webhookEvents.id, receiptIds)));
    if (conversationIds.length) await tx.delete(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), inArray(conversations.id, conversationIds)));
    if (contactIds.length) await tx.delete(contacts).where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, contactIds)));

    return requestId;
  });
}

export function deleteContact(workspaceId: string, contactId: string) {
  return eraseWorkspace(workspaceId, "contact_request", new Date(), contactId);
}

export async function sweepLocalRetention(now = new Date()) {
  const workspacesToSweep = await db.select({ id: workspaces.id }).from(workspaces);
  let erased = 0;
  let failed = 0;
  for (const { id } of workspacesToSweep) {
    try {
      if (await eraseWorkspace(id, "retention", now)) erased++;
    } catch {
      failed++;
    }
  }
  // Inboxes from before tenant scoping cannot be attributed or acted on at a provider.
  const [shortest] = await db.select({ days: sql<number>`coalesce(min(${workspaces.retentionDays}), 90)` }).from(workspaces);
  const legacyCutoff = new Date(now.getTime() - Math.max(1, shortest.days) * dayMs);
  const unscoped = await db.delete(webhookEvents).where(and(isNull(webhookEvents.workspaceId), lte(webhookEvents.receivedAt, legacyCutoff)))
    .returning({ id: webhookEvents.id });
  return { erased, failed, unscoped: unscoped.length };
}
