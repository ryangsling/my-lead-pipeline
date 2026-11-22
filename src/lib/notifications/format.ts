export const notificationEvents = ["booking_new", "lead_captured", "call_no_booking", "form_submitted", "booking_cancelled", "urgent_callback", "urgent_callback_escalation"] as const;
export type NotificationEvent = (typeof notificationEvents)[number];
export type MessageEvent = NotificationEvent | "test";

export const eventLabels: Record<NotificationEvent, string> = {
  booking_new: "New booking",
  lead_captured: "Lead captured",
  call_no_booking: "Call ended without a booking",
  form_submitted: "Form submitted",
  urgent_callback: "Urgent callback requested",
  urgent_callback_escalation: "Urgent callback escalation",
  booking_cancelled: "Booking cancelled",
};

/** Everything a notification may carry (rule 7). Anything else in a payload is dropped. */
export type NotificationPayload = {
  name?: string | null;
  phone?: string | null;
  service?: string | null;
  when?: string | null;
  summary?: string | null;
  link: string;
};

const fields = ["name", "phone", "service", "when", "summary", "link"] as const;

/** Keeps only the allowed fields, so a transcript or recording in a payload never reaches a log or a message. */
export function pickPayload(raw: Record<string, unknown>): NotificationPayload {
  const picked: Record<string, string> = {};
  for (const key of fields) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) picked[key] = value.trim();
  }
  return picked as NotificationPayload;
}

/** The first two sentences, at most 300 characters. */
export function twoLines(summary: string) {
  return summary
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join("\n")
    .slice(0, 300);
}

/** Subject and plain-text body: name, phone, service, time, a 2-line summary and a hub link. */
export function formatMessage(event: MessageEvent, raw: Record<string, unknown>) {
  const p = pickPayload(raw);
  if (event === "test") return { subject: "Agent Hub test message", body: "Agent Hub test message" };
  const lines = [
    p.name && `Name: ${p.name}`,
    p.phone && `Phone: ${p.phone}`,
    p.service && `Service: ${p.service}`,
    p.when && `When: ${p.when}`,
    p.summary && twoLines(p.summary),
    p.link && `Open: ${p.link}`,
  ].filter(Boolean);
  return { subject: p.name ? `${eventLabels[event]}: ${p.name}` : eventLabels[event], body: lines.join("\n") };
}
