import { and, eq, gt, lt, ne, notInArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, services } from "@/lib/db/schema";
import { getBusy, getWorkspaceCalendar, type WorkspaceCalendar } from "@/lib/google/calendar";
import { computeSlots, type WorkingHours } from "./slots";

function boundary(value: string | Date, zone: string, end: boolean) {
  const date =
    value instanceof Date ? DateTime.fromJSDate(value, { zone }) : DateTime.fromISO(value, { zone });
  if (!date.isValid) throw new Error("Invalid date range");
  return typeof value === "string" && value.length === 10 ? (end ? date.endOf("day") : date.startOf("day")) : date;
}

export type BookingService = typeof services.$inferSelect;
export type BookingContext = { service: BookingService; calendar: WorkspaceCalendar };

export type OpenSlot = { start: string; end: string };

/** Availability from working hours minus Google busy time and active hub appointments. */
export async function getOpenSlots(input: {
  workspaceId: string;
  serviceId: string;
  from: string | Date;
  to: string | Date;
  limit?: number;
  fresh?: boolean;
  excludeAppointmentId?: string;
  /** Skip hub appointments, leaving the database overlap lock as the only conflict check. */
  ignoreAppointments?: boolean;
}, context?: BookingContext): Promise<OpenSlot[]> {
  const [[service], calendar] = context ? [[context.service], context.calendar] : await Promise.all([
    db
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.workspaceId, input.workspaceId), eq(services.active, true))),
    getWorkspaceCalendar(input.workspaceId),
  ]);
  if (!service) throw new Error("Service not found");
  const now = DateTime.now().setZone(calendar.timezone);
  const horizon = now.plus({ days: calendar.row.maxDaysAhead }).endOf("day");
  const from = boundary(input.from, calendar.timezone, false);
  const to = boundary(input.to, calendar.timezone, true).setZone(calendar.timezone);
  if (!from.isValid || !to.isValid || to.toMillis() <= from.toMillis()) return [];

  const rangeStart = from.toMillis() < now.toMillis() ? now : from;
  const rangeEnd = to.toMillis() > horizon.toMillis() ? horizon : to;
  if (rangeEnd.toMillis() <= rangeStart.toMillis()) return [];

  const [busy, active] = await Promise.all([
    getBusy(calendar, rangeStart, rangeEnd, { fresh: input.fresh }),
    input.ignoreAppointments
      ? []
      : db
          .select({ startAt: appointments.startAt, blockedUntil: appointments.blockedUntil })
          .from(appointments)
          .where(
            and(
              eq(appointments.workspaceId, input.workspaceId),
              notInArray(appointments.status, ["cancelled", "no_show"]),
              lt(appointments.startAt, rangeEnd.toJSDate()),
              gt(appointments.blockedUntil, rangeStart.toJSDate()),
              input.excludeAppointmentId ? ne(appointments.id, input.excludeAppointmentId) : undefined,
            ),
          ),
  ]);

  const slots = computeSlots({
    hours: calendar.row.workingHours as WorkingHours,
    busy,
    appointments: active,
    durationMin: service.durationMin,
    bufferMin: service.bufferMin,
    stepMin: calendar.row.slotStepMin,
    now,
    minNoticeHours: calendar.row.minNoticeHours,
    maxDaysAhead: calendar.row.maxDaysAhead,
    timezone: calendar.timezone,
  }).filter((s) => s.toMillis() >= from.toMillis() && s.toMillis() <= to.toMillis());

  return slots.slice(0, input.limit ?? 100).map((s) => ({
    start: s.toISO({ suppressMilliseconds: true }) ?? s.toISO() ?? "",
    end:
      (s.plus({ minutes: service.durationMin }).toISO({ suppressMilliseconds: true }) ??
        s.plus({ minutes: service.durationMin }).toISO()) ??
      "",
  }));
}
