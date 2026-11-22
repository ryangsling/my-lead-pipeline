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
