import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { inPartOfDay, reference, spokenList, spokenTime, todayLine } from "@/lib/tools/speak";

describe("speak", () => {
  it("formats a slot in the workspace timezone", () => {
    expect(spokenTime("2027-03-28T09:00:00+01:00", "Europe/London")).toBe("Sunday 28 March at 9:00 AM");
    expect(spokenTime("2027-03-28T08:00:00Z", "Europe/London")).toBe("Sunday 28 March at 9:00 AM");
  });

  it("joins lists the way people say them", () => {
    expect(spokenList(["a"])).toBe("a");
    expect(spokenList(["a", "b"])).toBe("a or b");
    expect(spokenList(["a", "b", "c"])).toBe("a, b or c");
  });

  it("states today's date in the workspace timezone", () => {
    const now = DateTime.fromISO("2026-11-07T23:30:00Z").setZone("Asia/Dhaka");
    expect(todayLine(now)).toBe("Today is Sunday 8 November 2026.");
  });

  it("splits the day into morning, afternoon and evening", () => {
    const z = "Europe/London";
    expect(inPartOfDay("2027-03-01T11:30:00+00:00", z, "morning")).toBe(true);
    expect(inPartOfDay("2027-03-01T12:00:00+00:00", z, "afternoon")).toBe(true);
    expect(inPartOfDay("2027-03-01T17:00:00+00:00", z, "evening")).toBe(true);
    expect(inPartOfDay("2027-03-01T17:00:00+00:00", z, "afternoon")).toBe(false);
    expect(inPartOfDay("2027-03-01T17:00:00+00:00", z, "any")).toBe(true);
  });

  it("makes a short reference", () => {
    expect(reference("a1b2c3d4-0000-0000-0000-000000000000")).toBe("A1B2C3D4");
  });
});
