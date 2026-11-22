import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeSlots, type WorkingHours } from "@/lib/booking/slots";

const allDays = (open = "09:00", close = "12:00"): WorkingHours => ({
  mon: { open, close },
  tue: { open, close },
  wed: { open, close },
  thu: { open, close },
  fri: { open, close },
  sat: { open, close },
  sun: { open, close },
});

const base = {
  hours: allDays(),
  busy: [],
  appointments: [],
  durationMin: 30,
  bufferMin: 0,
  stepMin: 60,
  now: DateTime.fromISO("2027-03-01T08:00:00", { zone: "Europe/London" }),
  minNoticeHours: 0,
  maxDaysAhead: 0,
  timezone: "Europe/London",
};

const local = (slots: DateTime[]) => slots.map((s) => s.toFormat("HH:mm"));

describe("computeSlots", () => {
  it("returns starts inside working hours", () => {
    expect(local(computeSlots(base))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("skips slots that overlap busy time", () => {
    const slots = computeSlots({ ...base, busy: [{ start: "2027-03-01T10:00:00Z", end: "2027-03-01T10:15:00Z" }] });
    expect(local(slots)).toEqual(["09:00", "11:00"]);
  });

  it("applies the service buffer when checking overlap", () => {
    const slots = computeSlots({
      ...base,
      bufferMin: 15,
      busy: [{ start: "2027-03-01T11:40:00Z", end: "2027-03-01T12:00:00Z" }],
    });
    expect(local(slots)).toEqual(["09:00", "10:00"]);
  });

  it("skips hub appointments up to blockedUntil", () => {
    const slots = computeSlots({
      ...base,
      appointments: [{ startAt: "2027-03-01T10:00:00Z", blockedUntil: "2027-03-01T10:45:00Z" }],
    });
    expect(local(slots)).toEqual(["09:00", "11:00"]);
  });

  it("respects minimum notice", () => {
    const slots = computeSlots({
      ...base,
      now: DateTime.fromISO("2027-03-01T07:30:00", { zone: "Europe/London" }),
      minNoticeHours: 2,
    });
    expect(local(slots)).toEqual(["10:00", "11:00"]);
  });

  it("stops at the max days ahead horizon", () => {
    const slots = computeSlots({ ...base, maxDaysAhead: 2 });
    expect(local(slots)).toEqual(Array(3).fill(["09:00", "10:00", "11:00"]).flat());
    const near = computeSlots({ ...base, maxDaysAhead: 1 });
    expect(local(near)).toEqual(Array(2).fill(["09:00", "10:00", "11:00"]).flat());
  });

  it("returns nothing on closed days", () => {
    const slots = computeSlots({ ...base, hours: { mon: { open: "09:00", close: "12:00" } }, maxDaysAhead: 1 });
    expect(local(slots)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("returns nothing when the service does not fit before closing", () => {
    expect(computeSlots({ ...base, durationMin: 240 })).toEqual([]);
  });

  it("requires the service and buffer to fit before closing", () => {
    const hours = { mon: { open: "09:00", close: "11:45" } };
    expect(local(computeSlots({ ...base, hours, bufferMin: 15 }))).toEqual(["09:00", "10:00", "11:00"]);
    expect(local(computeSlots({ ...base, hours, bufferMin: 16 }))).toEqual(["09:00", "10:00"]);
  });

  it("offers the tail of yesterday's overnight shift even if today is closed", () => {
    const overnight = { ...base, hours: { mon: { open: "20:00", close: "06:00" } }, durationMin: 60, bufferMin: 30 };
    const now = base.now.set({ hour: 22 });
    expect(local(computeSlots({ ...overnight, now }))).toEqual(["22:00", "23:00"]);
    expect(local(computeSlots({ ...overnight, now: now.plus({ hours: 3 }) }))).toEqual(["01:00", "02:00", "03:00", "04:00"]);
  });

  it("combines overlapping overnight and same-day shifts in chronological order without duplicates", () => {
    const now = base.now.plus({ days: 1 }).startOf("day");
    const hours = { mon: { open: "22:00", close: "03:00" }, tue: { open: "01:00", close: "05:00" } };
    expect(local(computeSlots({ ...base, now, hours }))).toEqual(["00:00", "01:00", "02:00", "03:00", "04:00"]);
  });

  it("keeps London local times across spring forward", () => {
    const slots = computeSlots({
      ...base,
      hours: { sun: { open: "09:00", close: "12:00" } },
      now: DateTime.fromISO("2027-03-28T00:00:00", { zone: "Europe/London" }),
      maxDaysAhead: 0,
    });
    expect(local(slots)).toEqual(["09:00", "10:00", "11:00"]);
    expect(slots.map((s) => s.toFormat("ZZ"))).toEqual(["+01:00", "+01:00", "+01:00"]);
    expect(slots.map((s) => s.toUTC().toFormat("HH:mm"))).toEqual(["08:00", "09:00", "10:00"]);
  });

  it("keeps London local times across fall back", () => {
    const slots = computeSlots({
      ...base,
      hours: { sun: { open: "09:00", close: "12:00" } },
      now: DateTime.fromISO("2027-10-31T00:00:00", { zone: "Europe/London" }),
      maxDaysAhead: 0,
    });
    expect(local(slots)).toEqual(["09:00", "10:00", "11:00"]);
    expect(slots.map((s) => s.toFormat("ZZ"))).toEqual(["+00:00", "+00:00", "+00:00"]);
    expect(slots.map((s) => s.toUTC().toFormat("HH:mm"))).toEqual(["09:00", "10:00", "11:00"]);
  });

  const usZones = [
    { timezone: "America/New_York", standard: "-05:00", daylight: "-04:00" },
    { timezone: "America/Chicago", standard: "-06:00", daylight: "-05:00" },
    { timezone: "America/Denver", standard: "-07:00", daylight: "-06:00" },
    { timezone: "America/Phoenix", standard: "-07:00", daylight: "-07:00" },
    { timezone: "America/Los_Angeles", standard: "-08:00", daylight: "-07:00" },
  ];

  const transitionSlots = (date: string, timezone: string) => computeSlots({
    ...base,
    hours: { sat: { open: "23:30", close: "04:00" } },
    now: DateTime.fromISO(date, { zone: timezone }),
    timezone,
    stepMin: 30,
  });

  it.each(usZones)("walks actual instants across the US spring transition in $timezone", ({ timezone, standard, daylight }) => {
    const slots = transitionSlots("2027-03-14", timezone);
    expect(slots.map(s => s.toFormat("HH:mm ZZ"))).toEqual([
      `00:00 ${standard}`, `00:30 ${standard}`, `01:00 ${standard}`, `01:30 ${standard}`,
      ...(standard === daylight ? [`02:00 ${standard}`, `02:30 ${standard}`] : []),
      `03:00 ${daylight}`, `03:30 ${daylight}`,
    ]);
    expect(slots.slice(1).every((s, i) => s.toMillis() - slots[i].toMillis() === 30 * 60_000)).toBe(true);
  });

  it.each(usZones)("preserves every fall-back 1:30 instant in $timezone", ({ timezone, standard, daylight }) => {
    const slots = transitionSlots("2027-11-07", timezone);
    expect(slots.filter(s => s.hour === 1 && s.minute === 30).map(s => s.toISO({ suppressMilliseconds: true }))).toEqual([
      ...(standard === daylight ? [] : [`2027-11-07T01:30:00${daylight}`]),
      `2027-11-07T01:30:00${standard}`,
    ]);
    expect(slots.slice(1).every((s, i) => s.toMillis() - slots[i].toMillis() === 30 * 60_000)).toBe(true);
  });

  it.each([
    { date: "2027-03-14", newYork: 6, london: 8 },
    { date: "2027-03-28", newYork: 8, london: 6 },
    { date: "2027-10-31", newYork: 8, london: 10 },
    { date: "2027-11-07", newYork: 10, london: 8 },
  ])("uses each business timezone's transition week on $date", ({ date, newYork, london }) => {
    expect(transitionSlots(date, "America/New_York")).toHaveLength(newYork);
    expect(transitionSlots(date, "Europe/London")).toHaveLength(london);
  });

  it("uses the first repeated opening and the second repeated closing", () => {
    const timezone = "America/New_York";
    const now = DateTime.fromISO("2027-11-07", { zone: timezone });
    const hours = { sun: { open: "01:15", close: "01:45" } };
    const slots = computeSlots({ ...base, now, timezone, hours, stepMin: 15 });
    expect(slots.map(s => s.toFormat("HH:mm ZZ"))).toEqual([
      "01:15 -04:00", "01:30 -04:00", "01:45 -04:00", "01:00 -05:00", "01:15 -05:00",
    ]);
  });
});
