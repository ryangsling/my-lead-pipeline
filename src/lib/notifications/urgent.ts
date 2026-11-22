import { and, eq, sql } from "drizzle-orm";
import { saveJob, type JobIntake } from "@/lib/crm/jobs";
import { db } from "@/lib/db/client";
import { contacts, conversations, urgentEvents, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { notify } from "./send";

export async function notifyUrgent(
  workspaceId: string, conversationId: string, contactId: string, timezone: string,
  intake: JobIntake & { name: string },
) {
  const key = { workspaceId, conversationId };
  const event = and(eq(urgentEvents.workspaceId, workspaceId), eq(urgentEvents.conversationId, conversationId));
  const [row] = await db.select({
    callbackMinutes: workspaces.callbackMinutes, slug: workspaces.slug, phone: contacts.phoneE164,
  }).from(workspaces).innerJoin(contacts, and(eq(contacts.workspaceId, workspaces.id), eq(contacts.id, contactId)))
    .where(eq(workspaces.id, workspaceId));
  if (!row) return { sent: false, callbackMinutes: 15 };

  await saveJob({ ...key, contactId, timezone, intake: { ...intake, urgency: "urgent" } });
  await db.transaction(async (tx) => {
    await tx.insert(urgentEvents).values(key).onConflictDoNothing();
    await tx.update(conversations).set({
      contactId, outcome: sql`case when ${conversations.outcome} = 'booked' then 'booked' else 'urgent' end`,
    }).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)));
  });

  const link = `${env.APP_URL}/w/${row.slug}/conversations/${conversationId}`;
  const results = await notify(workspaceId, "urgent_callback", {
    name: intake.name, phone: row.phone, summary: "The caller requested urgent help.", link,
  }, `urgent_callback:${conversationId}`, { retries: 0, timeoutMs: 900 });
  if (results.some((result) => result.ok)) {
    await db.update(urgentEvents).set({ sent: true }).where(event);
  }
  const [saved] = await db.select({ sent: urgentEvents.sent }).from(urgentEvents).where(event);
  return { sent: saved.sent, callbackMinutes: row.callbackMinutes };
}
