import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, services } from "@/lib/db/schema";
import { createEvent, deleteEvent, getWorkspaceCalendar, moveEvent } from "@/lib/google/calendar";
import { getOpenSlots } from "./availability";
import { eventDetails } from "./event";
import type { Appointment } from "./book";

export const appointmentStatuses = [
  "requested",
  "booked",
  "confirmed",
  "rescheduled",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export type StatusResult = { ok: true; appointment: Appointment } | { ok: false; message: string };

/** Cancelling frees the slot and removes the Google event; a new start moves it. */
export async function updateAppointmentStatus(
  workspaceId: string,
  id: string,
  status: AppointmentStatus,
  newStart?: string | Date,
): Promise<StatusResult> {
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.workspaceId, workspaceId)));
  if (!appointment) return { ok: false, message: "Appointment not found" };

  const calendar = await getWorkspaceCalendar(workspaceId).catch(() => null);
  if (!calendar) return { ok: false, message: "Google Calendar is not connected" };

  if (newStart) {
    const [service] = appointment.serviceId
      ? await db
          .select()
          .from(services)
          .where(and(eq(services.id, appointment.serviceId), eq(services.workspaceId, workspaceId)))
      : [];
    if (!service) return { ok: false, message: "The appointment has no service to move" };

    const start =
      newStart instanceof Date
        ? DateTime.fromJSDate(newStart, { zone: calendar.timezone })
        : DateTime.fromISO(newStart, { zone: calendar.timezone, setZone: true }).setZone(calendar.timezone);
    if (!start.isValid) return { ok: false, message: "That time is not valid" };

    const from = start.startOf("day").toISO();
    const to = start.endOf("day").toISO();
    if (!from || !to) return { ok: false, message: "That time is not valid" };
    const slots = await getOpenSlots({
      workspaceId,
      serviceId: service.id,
      from,
      to,
      fresh: true,
      limit: 1_000,
      excludeAppointmentId: appointment.id,
    }).catch(() => null);
    if (!slots) return { ok: false, message: "Google Calendar could not be reached" };
    if (!slots.some((slot) => DateTime.fromISO(slot.start, { setZone: true }).toMillis() === start.toMillis())) {
      return { ok: false, message: "That time is not available" };
    }

    const end = start.plus({ minutes: service.durationMin });
    const blockedUntil = end.plus({ minutes: service.bufferMin });
    try {
      let googleEventId = appointment.googleEventId;
      if (googleEventId) {
        await moveEvent(calendar, googleEventId, { start, end, timezone: calendar.timezone });
      } else {
        googleEventId = await createEvent(calendar, {
          ...(await eventDetails(workspaceId, appointment.contactId, service.name, appointment.notes)),
          start,
          end,
          timezone: calendar.timezone,
        });
      }
      const [saved] = await db
        .update(appointments)
        .set({
          startAt: start.toJSDate(),
          endAt: end.toJSDate(),
          blockedUntil: blockedUntil.toJSDate(),
          status: "rescheduled",
          googleEventId,
        })
        .where(and(eq(appointments.id, id), eq(appointments.workspaceId, workspaceId)))
        .returning();
      return saved ? { ok: true, appointment: saved } : { ok: false, message: "Appointment not found" };
    } catch {
      return { ok: false, message: "Google Calendar could not move the event" };
    }
  }

  if ((status === "cancelled" || status === "no_show") && appointment.googleEventId) {
    try {
      await deleteEvent(calendar, appointment.googleEventId);
    } catch {
      return { ok: false, message: "Google Calendar could not delete the event" };
    }
  }

  const [saved] = await db
    .update(appointments)
    .set({ status })
    .where(and(eq(appointments.id, id), eq(appointments.workspaceId, workspaceId)))
    .returning();
  return saved ? { ok: true, appointment: saved } : { ok: false, message: "Appointment not found" };
}
