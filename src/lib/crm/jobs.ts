import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { siteFields } from "@/lib/booking/coverage";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

export const intakeFields = {
  ...siteFields,
  job_type: z.string().trim().max(100).optional(),
  problem: z.string().trim().max(500).optional(),
  urgency: z.string().trim().max(80).optional(),
  callback_window: z.string().trim().max(120).optional(),
  lead_source: z.enum(["google", "referral", "yard_sign", "other"]).optional(),
};

export type JobIntake = z.infer<z.ZodObject<typeof intakeFields>>;

export async function saveJob(input: {
  workspaceId: string;
  contactId?: string | null;
  conversationId?: string | null;
  appointmentId?: string | null;
  timezone: string;
  intake: JobIntake;
}, connection: Pick<typeof db, "insert"> = db) {
  const { intake, ...identity } = input;
  const fields = {
    ...identity,
    address: intake.address || undefined,
    zip: intake.zip || undefined,
    city: intake.city || undefined,
    jobType: intake.job_type || undefined,
    problem: intake.problem || undefined,
    urgency: intake.urgency || undefined,
    callbackWindow: intake.callback_window || undefined,
    leadSource: intake.lead_source,
  };
  const target = input.conversationId ? [jobs.workspaceId, jobs.conversationId] : [jobs.workspaceId, jobs.appointmentId];
  return connection.insert(jobs).values(fields).onConflictDoUpdate({ target, set: fields });
}

export async function getConversationJob(workspaceId: string, conversationId: string) {
  const [job] = await db.select().from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.conversationId, conversationId)));
  return job;
}
