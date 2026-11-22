import { DateTime } from "luxon";

export type PartOfDay = "morning" | "afternoon" | "evening" | "any";

/** "Saturday 7 November at 10:00 AM", in the workspace timezone. */
export function spokenTime(iso: string, zone: string) {
  const start = DateTime.fromISO(iso, { zone });
  const label = start.toFormat("cccc d LLLL 'at' h:mm a");
  const occurrences = start.getPossibleOffsets();
  if (occurrences.length < 2) return label;
  const afterChange = occurrences.some(time => time < start);
  return `${label} (${afterChange ? "after" : "before"} the clocks change)`;
}

/** "A", "A or B", "A, B or C". */
export function spokenList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Every tool reply ends with this, so the model always knows the date. */
export function todayLine(now: DateTime) {
  return `Today is ${now.toFormat("cccc d LLLL yyyy")}.`;
}

export function inPartOfDay(iso: string, zone: string, part: PartOfDay) {
  if (part === "any") return true;
  const hour = DateTime.fromISO(iso, { zone }).hour;
  if (part === "morning") return hour < 12;
  if (part === "afternoon") return hour >= 12 && hour < 17;
  return hour >= 17;
}

export function reference(appointmentId: string) {
  return appointmentId.slice(0, 8).toUpperCase();
}
