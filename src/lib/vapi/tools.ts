export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const intakeProperties = {
  address: { type: "string", description: "Street address at the job site" },
  zip: { type: "string", description: "Five-digit ZIP code at the job site" },
  city: { type: "string", description: "City at the job site" },
  job_type: { type: "string", description: "Type of work requested" },
  problem: { type: "string", description: "Short description of the problem" },
  urgency: { type: "string", description: "Use urgent if the caller needs an immediate contractor callback" },
  callback_window: { type: "string", description: "Preferred callback window in the workspace local time" },
  lead_source: { type: "string", enum: ["google", "referral", "yard_sign", "other"] },
};

/** The P0 hub tools. find_booking is P1 and not exposed. */
export const toolDefinitions: ToolDefinition[] = [
  {
    name: "notify_urgent",
    description: "Record an urgent callback and alert the owner during the call. Give life-safety instructions first when needed.",
    parameters: {
      type: "object",
      properties: {
        ...intakeProperties,
        name: { type: "string", description: "Caller name" },
        phone: { type: "string", description: "Usable callback number" },
      },
      required: ["name", "phone", "problem"],
    },
  },
  {
    name: "check_availability",
    description: "Check open appointment slots for a service on a date or date range.",
    parameters: {
      type: "object",
      properties: {
        zip: { type: "string", description: "Five-digit ZIP code at the job site" },
        city: { type: "string", description: "City at the job site" },
        service: { type: "string", description: "Service name as listed by the business" },
        date: { type: "string", description: "Today, tomorrow, or an ISO date (YYYY-MM-DD). Use lowercase today or tomorrow for relative dates." },
        part_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"], description: "Preferred part of the day" },
      },
      required: ["service"],
    },
  },
  {
    name: "book_appointment",
    description: "Book an appointment for the caller once they have chosen a slot.",
    parameters: {
      type: "object",
      properties: {
        ...intakeProperties,
        service: { type: "string", description: "Service name as listed by the business" },
        slot_id: { type: "string", description: "Opaque slot_id from the options offered on this call. Never read it aloud." },
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Caller's phone number" },
        email: { type: "string", description: "Caller's email address, if given" },
        notes: { type: "string", description: "Anything else the caller wants the team to know" },
      },
      required: ["service", "slot_id", "name", "phone"],
    },
  },
  {
    name: "capture_lead",
    description: "Save the caller's details when they do not book an appointment.",
    parameters: {
      type: "object",
      properties: {
        ...intakeProperties,
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Caller's phone number" },
        email: { type: "string", description: "Caller's email address, if given" },
        reason: { type: "string", description: "What the caller asked about" },
        preferred_time: { type: "string", description: "When the caller would like a callback" },
      },
      required: ["name", "phone"],
    },
  },
];

export function buildToolBody(definition: ToolDefinition, server: { url: string; headers: Record<string, string> }) {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
    server,
    async: false,
  };
}
