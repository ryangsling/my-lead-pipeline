import { tool } from "ai";
import { z } from "zod";
import { siteFields } from "@/lib/booking/coverage";
import { intakeFields } from "@/lib/crm/jobs";

const required = z.string().trim().min(1).max(120);
const person = {
  name: required, phone: z.string().trim().min(1).max(40), email: z.email().max(254).optional(),
};

export const chatTools = {
  check_availability: tool({
    description: "Offer availability for a service. Use today or tomorrow for relative dates.",
    inputSchema: z.object({
      ...siteFields, service: required, date: z.union([z.literal("today"), z.literal("tomorrow"), z.iso.date()]).optional(),
      part_of_day: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
    }),
  }),
  book_appointment: tool({
    description: "Book the slot the visitor selected, using its opaque slot_id. Never invent one.",
    inputSchema: z.object({ ...intakeFields, ...person, service: required, slot_id: z.uuid(), notes: z.string().max(500).optional() }),
  }),
  capture_lead: tool({
    description: "Save contact details for the team to call back.",
    inputSchema: z.object({ ...intakeFields, ...person, reason: z.string().max(500).optional(),
      preferred_time: z.string().max(120).optional() }),
  }),
};
