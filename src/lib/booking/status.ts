import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, services, type CalendarOperation } from "@/lib/db/schema";
import { getWorkspaceCalendar, otherBusyEvents } from "@/lib/google/calendar";
import { erasedAppointmentTitle, eventDetails } from "./event";
import { appointmentKey, isOverlap, pendingResult, reconcileAppointment } from "./reconcile";
import { computeSlots, type WorkingHours } from "./slots";
import type { Appointment } from "./book";

export const appointmentStatuses = ["requested", "booked", "confirmed", "rescheduled", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];
export type StatusResult = { ok: true; appointment: Appointment } | { ok: false; message: string };
const inactive = (status: string) => status === "cancelled" || status === "no_show";
const taken = { ok: false, message: "That time is not available" } as const;

export async function updateAppointmentStatus(
  workspaceId: string, id: string, status: AppointmentStatus, newStart?: string | Date,
): Promise<StatusResult> {
  const calendar = await getWorkspaceCalendar(workspaceId).catch(() => null);
  const key = appointmentKey(workspaceId, id);
  try {
    const result = await db.transaction(async (tx): Promise<StatusResult | CalendarOperation> => {
      const [a] = await tx.select().from(appointments).where(key).for("update");
      if (!a) return { ok: false, message: "Appointment not found" };
      if (a.calendarOperation) return pendingResult;
      if (a.status === "needs_review" || (!a.googleEventId && !inactive(a.status) && a.status !== "requested")) {
        return { ok: false, message: "Match the existing booking to its Google event before changing it." };
      }
      if (!calendar) return { ok: false, message: "Google Calendar is not connected" };
      const removing = inactive(status) && !newStart;
      if (!newStart && ((removing && inactive(a.status)) || (!removing && !inactive(a.status) && a.googleEventId))) {
        const [appointment] = await tx.update(appointments).set({ status }).where(key).returning();
        return { ok: true, appointment };
      }
      if (removing && !a.googleEventId) {
        const [appointment] = await tx.update(appointments).set({ status }).where(key).returning();
        return { ok: true, appointment };
      }

      const kind = removing ? "remove" : inactive(a.status) || !a.googleEventId ? "create" : "move";
      const operationId = crypto.randomUUID();
      const eventId = kind === "create" ? operationId.replaceAll("-", "") : a.googleEventId!;
      const calendarId = a.googleCalendarId ?? calendar.calendarId;
      const op: CalendarOperation = {
        id: operationId, kind, phase: "apply", previousStatus: a.status,
        nextStatus: newStart ? "rescheduled" : status, timezone: calendar.timezone,
      };
      let targetStart: Date | null = null, targetEnd: Date | null = null, targetBlockedUntil: Date | null = null;
      if (!removing) {
        const [service] = a.serviceId ? await tx.select().from(services)
          .where(and(eq(services.id, a.serviceId), eq(services.workspaceId, workspaceId), eq(services.active, true))) : [];
        if (!service) return { ok: false, message: "The appointment has no active service" };
        const start = typeof newStart === "string" ? DateTime.fromISO(newStart, { zone: calendar.timezone })
          : DateTime.fromJSDate(newStart ?? a.startAt, { zone: calendar.timezone });
        if (!start.isValid) return { ok: false, message: "That time is not valid" };
        const slots = computeSlots({
          hours: calendar.row.workingHours as WorkingHours, busy: [], appointments: [],
          durationMin: service.durationMin, bufferMin: service.bufferMin, stepMin: calendar.row.slotStepMin,
          now: DateTime.now(), minNoticeHours: calendar.row.minNoticeHours,
          maxDaysAhead: calendar.row.maxDaysAhead, timezone: calendar.timezone,
        });
        if (!slots.some(slot => slot.toMillis() === start.toMillis())) return taken;
        targetStart = start.toJSDate();
        targetEnd = start.plus({ minutes: service.durationMin }).toJSDate();
        targetBlockedUntil = start.plus({ minutes: service.durationMin + service.bufferMin }).toJSDate();
        if (await otherBusyEvents({ ...calendar, calendarId, deadline: AbortSignal.timeout(3000) }, targetStart, targetBlockedUntil, eventId)) return taken;
        if (kind === "create") Object.assign(op, a.piiErasedAt ? { summary: erasedAppointmentTitle }
          : await eventDetails(workspaceId, a.contactId, service.name, a.notes, tx));
      }

      await tx.update(appointments).set({
        status: "pending", calendarOperation: op, reconcileAt: new Date(), googleEventId: eventId, googleCalendarId: calendarId,
        targetStart, targetEnd, targetBlockedUntil,
      }).where(key);
      return op;
    });
    if ("ok" in result) return result;
    return reconcileAppointment(workspaceId, id, result, calendar!);
  } catch (error) {
    if (isOverlap(error)) return taken;
    return { ok: false, message: "The appointment change could not be verified. Check the appointment before trying again." };
  }
}
