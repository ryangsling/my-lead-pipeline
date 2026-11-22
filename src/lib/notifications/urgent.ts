import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { saveJob, type JobIntake } from "@/lib/crm/jobs";
import { db } from "@/lib/db/client";
import { contacts, conversations, urgentEvents, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { NotificationPayload } from "./format";
import { deliverNotifications, enqueue, queuedNotifications } from "./send";

const URGENT_DEADLINE_MS = 60_000;
const urgentKey = (workspaceId: string, conversationId: string) =>
  and(eq(urgentEvents.workspaceId, workspaceId), eq(urgentEvents.conversationId, conversationId));

export async function notifyUrgent(
  workspaceId: string, conversationId: string, contactId: string, timezone: string,
  intake: JobIntake & { name: string },
  defer?: (work: () => Promise<void>) => void,
) {
  const [row] = await db.select({
    callbackMinutes: workspaces.callbackMinutes, slug: workspaces.slug, phone: contacts.phoneE164,
  }).from(workspaces).innerJoin(contacts, and(eq(contacts.workspaceId, workspaces.id), eq(contacts.id, contactId)))
    .where(eq(workspaces.id, workspaceId));
  if (!row) return { sent: false, callbackMinutes: 15 };

  const key = { workspaceId, conversationId };
  const dedupeKey = `urgent_callback:${conversationId}`;
  const payload = {
    name: intake.name, phone: row.phone, summary: "The caller requested urgent help.",
    link: `${env.APP_URL}/w/${row.slug}/conversations/${conversationId}`,
  };
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(urgentEvents)
      .values({ ...key, payload, deadlineAt: new Date(Date.now() + URGENT_DEADLINE_MS) })
      .onConflictDoNothing().returning({ conversationId: urgentEvents.conversationId });
    if (!created) return;
    await saveJob({ ...key, contactId, timezone, intake: { ...intake, urgency: "urgent" } }, tx);
    await tx.update(conversations).set({
      contactId, outcome: sql`case when ${conversations.outcome} = 'booked' then 'booked' else 'urgent' end`,
    }).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)));
    await enqueue(workspaceId, "urgent_callback", payload, dedupeKey, { connection: tx, urgentConversationId: conversationId });
  });

  const deliveries = await queuedNotifications(workspaceId, dedupeKey);
  if (deliveries.length) {
    await deliverNotifications(deliveries, { once: true, timeoutMs: 700 });
    defer?.(async () => { await deliverNotifications(deliveries); });
  }
  const [saved] = await db.select({ sent: urgentEvents.sent }).from(urgentEvents).where(urgentKey(workspaceId, conversationId));
  return { sent: saved.sent, callbackMinutes: row.callbackMinutes };
}

export async function getUrgentEvent(workspaceId: string, conversationId: string) {
  const [row] = await db.select().from(urgentEvents).where(urgentKey(workspaceId, conversationId));
  return row;
}

export async function acknowledgeUrgent(workspaceId: string, conversationId: string) {
  await db.update(urgentEvents).set({ acknowledgedAt: new Date() }).where(and(
    urgentKey(workspaceId, conversationId), isNull(urgentEvents.acknowledgedAt),
  ));
}

const missedDeadline = (now: Date) => and(
  lte(urgentEvents.deadlineAt, now), isNull(urgentEvents.deadlineMissedAt),
  or(isNull(urgentEvents.acknowledgedAt), gt(urgentEvents.acknowledgedAt, urgentEvents.deadlineAt)),
);

export async function sweepUrgentDeadlines() {
  const now = new Date();
  const rows = await db.select({ workspaceId: urgentEvents.workspaceId, conversationId: urgentEvents.conversationId })
    .from(urgentEvents).where(missedDeadline(now)).orderBy(asc(urgentEvents.deadlineAt)).limit(20);
  const results = await Promise.allSettled(rows.map(({ workspaceId, conversationId }) => db.transaction(async (tx) => {
    const key = urgentKey(workspaceId, conversationId);
    const [updated] = await tx.update(urgentEvents).set({ deadlineMissedAt: now })
      .where(and(key, missedDeadline(now))).returning({ payload: urgentEvents.payload });
    if (!updated) return false;
    const deliveries = await enqueue(workspaceId, "urgent_callback_escalation", updated.payload as NotificationPayload,
      `urgent_callback_escalation:${conversationId}`, { connection: tx, urgentConversationId: conversationId, excludeEvent: "urgent_callback" });
    if (deliveries.length) await tx.update(urgentEvents).set({ escalatedAt: now }).where(key);
    return deliveries.length > 0;
  })));
  return { examined: rows.length, escalated: results.filter((result) => result.status === "fulfilled" && result.value).length };
}
