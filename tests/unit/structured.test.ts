import { describe, expect, it } from "vitest";
import { buildStructuredSchema, defaultStructuredFields, readStructuredFields } from "@/lib/vapi/structured";

describe("structured fields", () => {
  it("falls back to the A4 defaults when nothing is stored", () => {
    expect(readStructuredFields([])).toEqual(defaultStructuredFields);
    expect(readStructuredFields(null)).toEqual(defaultStructuredFields);
  });

  it("uses stored field names", () => {
    expect(readStructuredFields(["name", "booked"])).toEqual(["name", "booked"]);
  });

  it("types booked as boolean and everything else as string", () => {
    expect(buildStructuredSchema(["name", "booked"])).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        booked: { type: "boolean", description: "True if an appointment was booked" },
      },
    });
  });
});
