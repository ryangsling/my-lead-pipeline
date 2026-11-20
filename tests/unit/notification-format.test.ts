import { describe, expect, it } from "vitest";
import { formatMessage, pickPayload, twoLines } from "@/lib/notifications/format";

const payload = {
  name: "Ada Lovelace",
  phone: "+447700900123",
  service: "Cut",
  when: "Tue 10 Nov 2026, 10:00",
  summary: "Ada booked a cut. She prefers mornings. She asked about parking. She will bring her daughter.",
  link: "https://hub.example/w/bloom/conversations/1",
};

describe("formatMessage", () => {
  it("carries name, phone, service, time, a 2-line summary and the link", () => {
    const { subject, body } = formatMessage("booking_new", payload);
    expect(subject).toBe("New booking: Ada Lovelace");
    expect(body.split("\n")).toEqual([
      "Name: Ada Lovelace",
      "Phone: +447700900123",
      "Service: Cut",
      "When: Tue 10 Nov 2026, 10:00",
      "Ada booked a cut.",
      "She prefers mornings.",
      "Open: https://hub.example/w/bloom/conversations/1",
    ]);
  });

  it("never includes a transcript, recording or any other field, even when the payload has one", () => {
    const dirty = { ...payload, transcript: "AI: hello SECRET-LINE", recordingUrl: "https://rec.example/x.wav", structured: { a: 1 } };
    const { body } = formatMessage("lead_captured", dirty);
    expect(body).not.toContain("SECRET-LINE");
    expect(body).not.toContain("rec.example");
    expect(Object.keys(pickPayload(dirty)).sort()).toEqual(["link", "name", "phone", "service", "summary", "when"]);
  });

  it("leaves out fields that are missing", () => {
    expect(formatMessage("call_no_booking", { link: "https://hub.example/x" })).toEqual({
      subject: "Call ended without a booking",
      body: "Open: https://hub.example/x",
    });
  });

  it("keeps a summary to two sentences and 300 characters", () => {
    expect(twoLines("One. Two. Three.")).toBe("One.\nTwo.");
    expect(twoLines("x".repeat(500))).toHaveLength(300);
  });
});
