import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/crm/contacts";

describe("normalizePhone", () => {
  it("resolves messy UK formats to one E.164 number", () => {
    for (const input of ["07700 900123", "+44 7700 900123", "447700900123", "(0)7700-900123"]) {
      expect(normalizePhone(input, "GB")).toBe("+447700900123");
    }
  });

  it("uses the workspace country for national numbers", () => {
    expect(normalizePhone("(415) 555-2671", "US")).toBe("+14155552671");
  });

  it("rejects numbers that cannot exist", () => {
    for (const input of ["12", "", "not a number", "0770090"]) expect(normalizePhone(input, "GB")).toBeNull();
  });
});
