import { and, asc, eq, lte } from "drizzle-orm";
import { upsertContact } from "@/lib/crm/contacts";
import { saveJob } from "@/lib/crm/jobs";
import { enqueueBookingNew, notifyBookingCancelled, notifyCallEnded } from "@/lib/notifications/events";
import { db } from "@/lib/db/client";
import { appointments, conversations, type CalendarOperation } from "@/lib/db/schema";
import { createEvent, deleteEvent, getWorkspaceCalendar, moveEvent, otherBusyEvents, readEvent, type WorkspaceCalendar } from "@/lib/google/calendar";
import type { Appointment } from "./book";

export const pendingMessage = "Your request is saved. The calendar change is awaiting confirmation. Please keep this time on hold and contact the team before choosing another.";
export const pendingResult = { ok: false, reason: "pending", message: pendingMessage } as const;
const conflict = { ok: false, reason: "slot_taken", message: "That time is no longer available." } as const;
const cleared = { calendarOperation: null, reconcileAt: null, targetStart: null, targetEnd: null, targetBlockedUntil: null };
type Result = { ok: true; appointment: Appointment } | typeof pendingResult | typeof conflict;

export function isOverlap(error: unknown) {
  return (error as { cause?: { code?: string }; code?: string }).cause?.code === "23P01" ||
    (error as { code?: string }).code === "23P01";
}

export const appointmentKey = (workspaceId: string, id: string) =>
  and(eq(appointments.workspaceId, workspaceId), eq(appointments.id, id));

function matches(event: Awaited<ReturnType<typeof readEvent>>, start: Date, end: Date) {
  return Date.parse(event?.start?.dateTime ?? "") === start.getTime() && Date.parse(event?.end?.dateTime ?? "") === end.getTime();
}

async function applyOperation(workspaceId: string, id: string, expected: CalendarOperation, connected: WorkspaceCalendar): Promise<Result | "undo"> {
  return db.transaction(async tx => {
    const key = appointmentKey(workspaceId, id);
    const [a] = await tx.select().from(appointments).where(key).for("update");
    if (!a) return conflict;
    const op = a.calendarOperation;
    if (!op) return a.status === expected.nextStatus ? { ok: true, appointment: a } : conflict;
    if (op.id !== expected.id || !a.googleEventId || !a.googleCalendarId) return pendingResult;
    const calendar = { ...connected, calendarId: a.googleCalendarId };
    const eventId = a.googleEventId;
    const event = await readEvent(calendar, eventId);

    if (op.phase === "undo") {
      if (op.kind === "create") {
        if (event) await deleteEvent(calendar, eventId, event.etag!);
        else await otherBusyEvents(calendar, a.startAt, a.blockedUntil, eventId); // verify calendar access on 404
      } else {
        if (!event) throw new Error("Original Google event is missing");
        if (!matches(event, a.startAt, a.endAt)) {
          await moveEvent(calendar, eventId, event.etag!, { start: a.startAt, end: a.endAt, timezone: op.timezone });
        }
      }
      if (op.previousStatus === null) await tx.delete(appointments).where(key);
      else await tx.update(appointments).set({
        ...cleared, status: op.previousStatus, googleEventId: op.kind === "create" ? null : eventId,
      }).where(key);
      return conflict;
    }

    const start = a.targetStart ?? a.startAt;
    const end = a.targetEnd ?? a.endAt;
    const blockedUntil = a.targetBlockedUntil ?? a.blockedUntil;
    if (op.kind === "remove") {
      if (event) await deleteEvent(calendar, eventId, event.etag!);
      else await otherBusyEvents(calendar, start, blockedUntil, eventId);
    } else {
      if (!matches(event, start, end)) {
        const times = { start, end, timezone: op.timezone };
        if (event) await moveEvent(calendar, eventId, event.etag!, times);
        else if (op.kind === "create") await createEvent(calendar, eventId, { ...times, summary: op.summary, description: op.description, appointmentId: id });
        else throw new Error("Original Google event is missing");
      }
      if (await otherBusyEvents(calendar, start, blockedUntil, eventId)) {
        // Commit compensation before changing Google again so a restart repeats the same decision.
        await tx.update(appointments).set({ calendarOperation: { ...op, phase: "undo" } }).where(key);
        return "undo";
      }
    }
    let contactId = a.contactId;
    if (op.kind === "create" && op.previousStatus === null && op.publicContact) {
      const contact = await upsertContact({ workspaceId, source: "form", ...op.publicContact }, undefined, tx);
      if (!contact.ok) throw new Error("Invalid contact on a pending public booking");
      contactId = contact.id;
    }
    const [saved] = await tx.update(appointments).set({
      ...cleared, startAt: start, endAt: end, blockedUntil, status: op.nextStatus,
      contactId,
      googleEventId: op.kind === "remove" ? null : eventId,
    }).where(key).returning();
    if (op.previousStatus === null) {
      if (op.intake) await saveJob({
        workspaceId, appointmentId: id, conversationId: a.conversationId, contactId,
        timezone: op.timezone, intake: op.intake,
      }, tx);
      if (a.conversationId) await tx.update(conversations).set({ outcome: "booked", contactId: a.contactId })
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, a.conversationId)));
      if (a.source === "form" || a.source === "chat") await enqueueBookingNew(workspaceId, id, {}, tx);
    }
    return { ok: true, appointment: saved };
  });
}

export async function reconcileAppointment(workspaceId: string, id: string, op: CalendarOperation, context?: WorkspaceCalendar): Promise<Result> {
  try {
    const connected = context ?? await getWorkspaceCalendar(workspaceId);
    const calendar = { ...connected, deadline: connected.deadline ?? AbortSignal.timeout(4000) };
    const result = await applyOperation(workspaceId, id, op, calendar);
    if (result !== "undo") return result;
    const undone = await applyOperation(workspaceId, id, op, calendar);
    return undone === "undo" ? pendingResult : undone;
  } catch {
    // The reservation was committed before any provider request. A process exit
    // or failed local commit leaves it eligible for the next sweep.
    await db.update(appointments).set({ reconcileAt: new Date(Date.now() + 60_000) })
      .where(and(appointmentKey(workspaceId, id), eq(appointments.status, "pending"))).catch(() => {});
    return pendingResult;
  }
}

export async function reconcilePendingAppointments() {
  const rows = await db.select({ workspaceId: appointments.workspaceId, id: appointments.id, operation: appointments.calendarOperation })
    .from(appointments).where(lte(appointments.reconcileAt, new Date())).orderBy(asc(appointments.reconcileAt)).limit(20);
  let pending = 0;
  let examined = 0;
  const until = Date.now() + 45_000;
  for (const row of rows) {
    if (Date.now() >= until) break;
    if (row.operation) {
      examined++;
      const result = await reconcileAppointment(row.workspaceId, row.id, row.operation);
      if (!result.ok && result.reason === "pending") pending++;
      if (result.ok && row.operation.nextStatus === "cancelled") await notifyBookingCancelled(row.workspaceId, row.id);
      if (result.ok && row.operation.previousStatus === null) {
        const { source, conversationId } = result.appointment;
        if (source !== "form" && source !== "chat" && conversationId) {
          const [c] = await db.select({ endedAt: conversations.endedAt }).from(conversations)
            .where(and(eq(conversations.workspaceId, row.workspaceId), eq(conversations.id, conversationId)));
          if (c?.endedAt) await notifyCallEnded(row.workspaceId, conversationId);
        }
      }
    }
  }
  return { examined, pending };
}
