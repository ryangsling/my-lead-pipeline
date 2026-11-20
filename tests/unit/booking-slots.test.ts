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
});
