/** Structured fields extracted from every call (A4). */
export const defaultStructuredFields = ["name", "phone", "email", "service", "preferred_time", "booked", "urgency"];

export const dispositions = ["booked", "lead", "urgent", "price_question", "existing_customer", "vendor", "spam"] as const;

const descriptions: Record<string, string> = {
  name: "Caller's full name",
  phone: "Caller's phone number",
  email: "Caller's email address",
  service: "Service the caller asked about",
  preferred_time: "Time the caller prefers, in the caller's words",
  booked: "True if an appointment was booked",
  urgency: "How urgent the caller says the request is",
};

const booleanFields = new Set(["booked"]);

/** Reads the stored field list, falling back to the A4 defaults. */
export function readStructuredFields(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const fields = raw.filter((f): f is string => typeof f === "string" && f.trim() !== "");
    if (fields.length) return fields;
  }
  return defaultStructuredFields;
}

export function buildStructuredSchema(fields: string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          type: booleanFields.has(field) ? "boolean" : "string",
          ...(field === "disposition" ? { enum: dispositions } : {}),
          ...(descriptions[field] ? { description: descriptions[field] } : {}),
        },
      ]),
    ),
  };
}
