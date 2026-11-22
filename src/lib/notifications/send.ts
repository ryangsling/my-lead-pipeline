import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notificationChannels, notificationLog } from "@/lib/db/schema";
import { formatMessage, pickPayload, type MessageEvent, type NotificationPayload } from "./format";
import { sendMessage } from "./transport";

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * First try plus up to 3 retries after 1, 3 and 9 seconds (N3). Every attempt updates the log row.
 * Returns the final state, and never throws for a failed send.
 */
export async function deliver(logId: string, options: { retries?: number; delaysMs?: number[]; timeoutMs?: number } = {}) {
  const [row] = await db
    .select({
      workspaceId: notificationLog.workspaceId,
      event: notificationLog.event,
      payload: notificationLog.payload,
      type: notificationChannels.type,
      target: notificationChannels.target,
    })
    .from(notificationLog)
    .innerJoin(notificationChannels, eq(notificationChannels.id, notificationLog.channelId))
    .where(eq(notificationLog.id, logId));
  if (!row) {
    await db.update(notificationLog).set({ status: "failed", error: "Channel was removed" }).where(eq(notificationLog.id, logId));
    return { ok: false as const, error: "Channel was removed" };
  }

  const message = formatMessage(row.event as MessageEvent, row.payload as Record<string, unknown>);
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const retries = options.retries ?? delays.length;
  let error = "";
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await sendMessage(row.workspaceId, row, message, options.timeoutMs);
      await db.update(notificationLog).set({ status: "sent", attempts: attempt, error: null, sentAt: new Date() }).where(eq(notificationLog.id, logId));
      return { ok: true as const };
    } catch {
      error = "Delivery failed. Check the channel and provider settings.";
      const last = attempt === retries + 1;
      await db
        .update(notificationLog)
        .set({ status: last ? "failed" : "pending", attempts: attempt, error })
        .where(eq(notificationLog.id, logId));
      if (!last) await sleep(delays[attempt - 1]);
    }
  }
  return { ok: false as const, error };
}

/**
 * Logs one row per active channel subscribed to the event, then delivers each. A repeated dedupe key is skipped,
 * so a resent webhook notifies once. Only the whitelisted payload fields are stored.
 */
export async function notify(workspaceId: string, event: MessageEvent, payload: NotificationPayload, dedupeKey: string, options?: Parameters<typeof deliver>[1]) {
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.workspaceId, workspaceId), eq(notificationChannels.active, true)));
  const subscribed = channels.filter((c) => c.events.includes(event));
  if (!subscribed.length) return [];

  const inserted = await db
    .insert(notificationLog)
    .values(subscribed.map((c) => ({ workspaceId, channelId: c.id, event, dedupeKey, payload: pickPayload(payload) })))
    .onConflictDoNothing()
    .returning({ id: notificationLog.id });
  return Promise.all(inserted.map((row) => deliver(row.id, options)));
}

/** "Send test" for one channel: logs the attempt and tries once, so the admin sees the result at once. */
export async function sendTest(workspaceId: string, channelId: string) {
  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.workspaceId, workspaceId)));
  if (!channel) return null;
  const [row] = await db
    .insert(notificationLog)
    .values({ workspaceId, channelId, event: "test", dedupeKey: `test:${crypto.randomUUID()}`, payload: {} })
    .returning({ id: notificationLog.id });
  return deliver(row.id, { retries: 0 });
}
