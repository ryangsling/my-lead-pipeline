import { DateTime } from "luxon";
import { expect, it } from "vitest";
import { onCallNumber } from "@/lib/vapi/transfer";

it("selects the number by local opening hours", () => {
  const start = DateTime.fromISO("2026-11-23T10:00", { zone: "America/New_York" });
  const hours = { mon: { open: "09:00", close: "17:00" } };
  expect(onCallNumber(start, hours, "primary", "backup")).toBe("primary");
  expect(onCallNumber(start.set({ hour: 17 }), hours, "primary", "backup")).toBe("backup");
  expect(onCallNumber(start.plus({ days: 1 }), hours, "primary", "backup")).toBe("backup");
});

it("keeps the primary on call until the overnight shift closes", () => {
  const timezone = "America/New_York";
  const hours = { sat: { open: "20:00", close: "06:00" } };
  const number = (time: string) => onCallNumber(DateTime.fromISO(time, { zone: timezone }), hours, "primary", "backup");
  expect(number("2027-11-06T20:00")).toBe("primary");
  expect(number("2027-11-07T01:30-04:00")).toBe("primary");
  expect(number("2027-11-07T01:30-05:00")).toBe("primary");
  expect(number("2027-11-07T06:00")).toBe("backup");
});
