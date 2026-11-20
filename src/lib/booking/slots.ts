import { DateTime } from "luxon";

export type DayHours = { open: string; close: string };
/** Keys are `mon` to `sun`. A missing or null day is closed. */
export type WorkingHours = Partial<Record<string, DayHours | null>>;
export type Interval = { start: string; end: string };
export type AppointmentBlock = { startAt: Date | string; blockedUntil: Date | string };

const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
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

  const slots: DateTime[] = [];
  for (let offset = 0; offset <= input.maxDaysAhead; offset += 1) {
    const day = now.startOf("day").plus({ days: offset });
    if (day.toMillis() > latest.toMillis()) continue;
    const dayHours = input.hours[dayKeys[day.weekday - 1]];
    const open = dayHours ? minutes(dayHours.open) : null;
    const close = dayHours ? minutes(dayHours.close) : null;
    if (open === null || close === null || close <= open) continue;

    const openAt = day.set({ hour: Math.floor(open / 60), minute: open % 60, second: 0, millisecond: 0 });
    const endOfDay = day.set({ hour: Math.floor(close / 60), minute: close % 60, second: 0, millisecond: 0 });
    let cursor = openAt;

    while (cursor.plus({ minutes: input.durationMin }).toMillis() <= endOfDay.toMillis()) {
      if (cursor.toMillis() > latest.toMillis()) break;
      const end = cursor.plus({ minutes: input.durationMin + input.bufferMin });
      if (cursor.toMillis() >= earliest.toMillis() && !overlaps(cursor.toMillis(), end.toMillis(), blocked)) {
        slots.push(cursor);
      }
      cursor = cursor.plus({ minutes: input.stepMin });
    }
  }
  return slots;
}
