import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { intakeFields, type JobIntake } from "@/lib/crm/jobs";
import { db } from "@/lib/db/client";
import { appointments, calendars, services, workspaces, type CalendarOperation } from "@/lib/db/schema";
import { getWorkspaceCalendar } from "@/lib/google/calendar";
import { getOpenSlots, type BookingContext } from "./availability";
import { coverageError, validZip, type Site, type ServiceArea } from "./coverage";
import { reconcileAppointment } from "./reconcile";
import { eventDetails, formatEventDetails } from "./event";

export type Appointment = typeof appointments.$inferSelect;
type BookingFailure = { ok: false; reason: "pending" | "slot_taken" | "invalid_slot" | "calendar_error" | "outside_area" | "missing_location" | "booking_mode_changed"; message: string };
export type BookResult = { ok: true; appointment: Appointment } | BookingFailure;
export const bookingModeChanged = {
  ok: false,
  reason: "booking_mode_changed",
  message: "Booking options have changed. Refresh this page to continue.",
} as const satisfies BookingFailure;

export type BookAppointmentInput = {
  workspaceId: string;
  serviceId: string;
  contactId?: string | null;
  publicContact?: CalendarOperation["publicContact"];
  start: string | Date;
  source: "phone" | "web_voice" | "chat" | "form" | "admin";
  conversationId?: string | null;
  site?: Site;
  intake?: JobIntake;
  notes?: string | null;
};

/** Checks the service, site and current slot before any booking or lead is recorded. */
export async function validateBooking(
  input: Pick<BookAppointmentInput, "workspaceId" | "serviceId" | "start" | "site">,
  { context, ignoreAppointments }: { context?: BookingContext & { area: ServiceArea }; ignoreAppointments?: boolean } = {},
): Promise<BookingFailure | ({ ok: true; start: DateTime<true> } & BookingContext)> {
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
    ignoreAppointments,
    limit: 1_000,
  }, { service, calendar }).catch(() => null);
  if (!slots) return { ok: false, reason: "calendar_error", message: "Google Calendar could not be reached." };
  if (!slots.some((slot) => DateTime.fromISO(slot.start, { setZone: true }).toMillis() === start.toMillis())) {
    return { ok: false, reason: "invalid_slot", message: "That time is not available." };
  }
  return { ok: true, service, calendar, start };
}

export async function bookAppointment(input: BookAppointmentInput, context?: BookingContext & { area: ServiceArea }): Promise<BookResult> {
  const voice = input.source === "phone" || input.source === "web_voice";
  const deadline = AbortSignal.timeout(voice ? 1250 : 4000);
  const validation = await validateBooking(input, { context, ignoreAppointments: true });
  if (!validation.ok) return validation;
  const { service, calendar, start } = validation;

  const end = start.plus({ minutes: service.durationMin });
  const blockedUntil = end.plus({ minutes: service.bufferMin });
  const id = crypto.randomUUID();
  const notes = [input.notes, input.site?.address, input.site?.city, input.site?.zip].filter(Boolean).join("\n") || null;
  const details = input.publicContact
    ? formatEventDetails(service.name, notes, input.publicContact)
    : await eventDetails(input.workspaceId, input.contactId ?? null, service.name, notes);
  const operation: CalendarOperation = {
    id, kind: "create", phase: "apply", previousStatus: null, nextStatus: "booked", timezone: calendar.timezone, ...details,
    intake: input.intake && z.object(intakeFields).parse(input.intake),
    publicContact: input.publicContact,
  };
  const reserve = (connection: Pick<typeof db, "insert">) => connection.insert(appointments).values({
    id,
    workspaceId: input.workspaceId,
    serviceId: service.id,
    contactId: input.contactId ?? null,
    startAt: start.toJSDate(),
    endAt: end.toJSDate(),
    blockedUntil: blockedUntil.toJSDate(),
    status: "pending",
    googleCalendarId: calendar.calendarId,
    googleEventId: id.replaceAll("-", ""),
    calendarOperation: operation,
    reconcileAt: new Date(),
    source: input.source,
    conversationId: input.conversationId ?? null,
    notes: input.notes ?? null,
  }).onConflictDoNothing().returning({ id: appointments.id });
  const reserved = input.publicContact ? await db.transaction(async tx => {
    const [settings] = await tx.select({ requestOnly: calendars.publicBookingRequestOnly })
      .from(calendars).where(eq(calendars.workspaceId, input.workspaceId)).for("share");
    return settings?.requestOnly ? null : reserve(tx);
  }) : await reserve(db);
  if (!reserved) return bookingModeChanged;
  if (!reserved.length) return { ok: false, reason: "slot_taken", message: "That slot was just taken." };

  return reconcileAppointment(input.workspaceId, id, operation, { ...calendar, deadline });
}
