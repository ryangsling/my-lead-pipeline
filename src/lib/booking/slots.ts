import { DateTime } from "luxon";

export type DayHours = { open: string; close: string };
/** Keys are `mon` to `sun`. An overnight shift belongs to the day it opens. */
export type WorkingHours = Partial<Record<string, DayHours | null>>;
export type Interval = { start: string; end: string };
export type AppointmentBlock = { startAt: Date | string; blockedUntil: Date | string };

const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

function shiftBoundary(day: DateTime, minute: number, closing: boolean) {
  const time = day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
  // Luxon moves a skipped wall time forward by the gap. A repeated boundary opens
  // at the first occurrence and closes at the second so the shift stays continuous.
  return time.getPossibleOffsets().reduce((selected, option) => (
    (closing ? option > selected : option < selected) ? option : selected
  ), time);
}

export function workingShift(hours: WorkingHours, day: DateTime) {
  const shift = hours[dayKeys[day.weekday - 1]];
  if (!shift) return null;
  const open = minutes(shift.open);
  const close = minutes(shift.close);
  if (open === null || close === null || open === close) return null;

  return {
    start: shiftBoundary(day, open, false),
    end: shiftBoundary(close < open ? day.plus({ days: 1 }) : day, close, true),
  };
}

function overlaps(start: number, end: number, blocked: { start: number; end: number }[]) {
  return blocked.some((b) => start < b.end && end > b.start);
}

/** Open slot starts inside working hours, excluding busy time, appointments, notice and horizon. */
export function computeSlots(input: {
  hours: WorkingHours;
  busy: Interval[];
  appointments: AppointmentBlock[];
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  now: DateTime;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
}): DateTime[] {
  const now = input.now.setZone(input.timezone);
  const earliest = now.plus({ hours: input.minNoticeHours });
  const latest = now.plus({ days: input.maxDaysAhead }).endOf("day");
  const blocked = [
    ...input.busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
    ...input.appointments.map((a) => ({
      start: new Date(a.startAt).getTime(),
      end: new Date(a.blockedUntil).getTime(),
    })),
  ].filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  const occupiedMs = (input.durationMin + input.bufferMin) * 60_000;
  const slots = new Map<number, DateTime>();
  const today = now.startOf("day");
  for (let offset = -1; offset <= input.maxDaysAhead; offset += 1) {
    const shift = workingShift(input.hours, today.plus({ days: offset }));
    if (!shift) continue;

    const lastStart = Math.min(latest.toMillis(), shift.end.toMillis() - occupiedMs);
    for (let cursor = shift.start; cursor.toMillis() <= lastStart; cursor = cursor.plus({ minutes: input.stepMin })) {
      const start = cursor.toMillis();
      if (start >= earliest.toMillis() && !overlaps(start, start + occupiedMs, blocked)) {
        slots.set(start, cursor);
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.toMillis() - b.toMillis());
}
