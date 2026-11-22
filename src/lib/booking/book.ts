import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, services, workspaces } from "@/lib/db/schema";
import { createEvent, getWorkspaceCalendar } from "@/lib/google/calendar";
import { getOpenSlots, type BookingContext } from "./availability";
import { coverageError, validZip, type Site, type ServiceArea } from "./coverage";
import { eventDetails } from "./event";

export type Appointment = typeof appointments.$inferSelect;
export type BookResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: "slot_taken" | "invalid_slot" | "calendar_error" | "outside_area" | "missing_location"; message: string };

export type BookAppointmentInput = {
  workspaceId: string;
  serviceId: string;
  contactId?: string | null;
  start: string | Date;
  source: "phone" | "web_voice" | "chat" | "form" | "admin";
  conversationId?: string | null;
  site?: Site;
  notes?: string | null;
};

function pgCode(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

/** Validates with live Google free/busy, inserts with the overlap lock, then creates the event. */
export async function bookAppointment(input: BookAppointmentInput, context?: BookingContext & { area: ServiceArea }): Promise<BookResult> {
  const [service] = context ? [context.service] : await db
    .select()
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.workspaceId, input.workspaceId), eq(services.active, true)));
  if (!service) return { ok: false, reason: "invalid_slot", message: "That service is not available." };

  const [area] = context ? [context.area] : await db.select({ serviceZips: workspaces.serviceZips, serviceCities: workspaces.serviceCities })
    .from(workspaces).where(eq(workspaces.id, input.workspaceId));
  const issue = area && coverageError(area, input.site);
  if (issue) return { ok: false, reason: "outside_area", message: issue };
  if (service.visitKind === "estimate" && (!input.site?.address?.trim() || !validZip(input.site.zip))) {
    return { ok: false, reason: "missing_location", message: "An estimate visit needs the site address and ZIP code." };
  }

  const calendar = context?.calendar ?? await getWorkspaceCalendar(input.workspaceId).catch(() => null);
  if (!calendar) return { ok: false, reason: "calendar_error", message: "Google Calendar is not connected." };

  const start =
    input.start instanceof Date
      ? DateTime.fromJSDate(input.start, { zone: calendar.timezone })
      : DateTime.fromISO(input.start, { zone: calendar.timezone, setZone: true }).setZone(calendar.timezone);
  if (!start.isValid) return { ok: false, reason: "invalid_slot", message: "That time is not valid." };

  const from = start.startOf("day").toISO();
  const to = start.endOf("day").toISO();
  if (!from || !to) return { ok: false, reason: "invalid_slot", message: "That time is not valid." };
  const slots = await getOpenSlots({
    workspaceId: input.workspaceId,
    serviceId: service.id,
    from,
    to,
    fresh: true,
    ignoreAppointments: true,
    limit: 1_000,
  }, { service, calendar }).catch(() => null);
  if (!slots) return { ok: false, reason: "calendar_error", message: "Google Calendar could not be reached." };
  if (!slots.some((slot) => DateTime.fromISO(slot.start, { setZone: true }).toMillis() === start.toMillis())) {
    return { ok: false, reason: "invalid_slot", message: "That time is not available." };
  }

  const end = start.plus({ minutes: service.durationMin });
  const blockedUntil = end.plus({ minutes: service.bufferMin });
  let appointment: Appointment;
  try {
    [appointment] = await db
      .insert(appointments)
      .values({
        workspaceId: input.workspaceId,
        serviceId: service.id,
        contactId: input.contactId ?? null,
        startAt: start.toJSDate(),
        endAt: end.toJSDate(),
        blockedUntil: blockedUntil.toJSDate(),
        status: "booked",
        source: input.source,
        conversationId: input.conversationId ?? null,
        notes: input.notes ?? null,
      })
      .returning();
  } catch (error) {
    if (pgCode(error) === "23P01") {
      return { ok: false, reason: "slot_taken", message: "That slot was just taken." };
    }
    throw error;
  }

  try {
    const googleEventId = await createEvent(calendar, {
      ...(await eventDetails(input.workspaceId, input.contactId ?? null, service.name, [input.notes, input.site?.address, input.site?.city, input.site?.zip].filter(Boolean).join("\n") || null)),
      start,
      end,
      timezone: calendar.timezone,
    });
    const [saved] = await db
      .update(appointments)
      .set({ googleEventId })
      .where(and(eq(appointments.id, appointment.id), eq(appointments.workspaceId, input.workspaceId)))
      .returning();
    return { ok: true, appointment: saved ?? appointment };
  } catch {
    await db
      .delete(appointments)
      .where(and(eq(appointments.id, appointment.id), eq(appointments.workspaceId, input.workspaceId)));
    return { ok: false, reason: "calendar_error", message: "Google Calendar could not save the booking." };
  }
}
