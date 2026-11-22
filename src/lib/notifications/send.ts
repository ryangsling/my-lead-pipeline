import { setTimeout as sleep } from "node:timers/promises";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notificationChannels, notificationLog, urgentEvents } from "@/lib/db/schema";
import { formatMessage, pickPayload, type MessageEvent, type NotificationPayload } from "./format";
import { prepareDelivery, sendMessage } from "./transport";

export type NotificationRef = { workspaceId: string; id: string };
type Connection = Pick<typeof db, "select" | "insert">;
type DeliveryOptions = { once?: boolean; delaysMs?: number[]; timeoutMs?: number };

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];
const LEASE_MS = 15_000;
// Resend retains idempotency keys for 24 hours. Stop before the provider can forget ours.
const RESEND_REPLAY_MS = 23 * 60 * 60_000;
const DELIVERY_ERROR = "Delivery failed. Check the channel and provider settings.";
const UNCERTAIN_ERROR = "Provider acceptance could not be confirmed. Check before sending again.";

const identity = ({ workspaceId, id }: NotificationRef) =>
  and(eq(notificationLog.workspaceId, workspaceId), eq(notificationLog.id, id));

const due = (now: Date) => or(
  and(inArray(notificationLog.status, ["pending", "retryable"]), lte(notificationLog.nextAttemptAt, now)),
  and(eq(notificationLog.status, "processing"), lte(notificationLog.leaseUntil, now)),
);

type DeliveryResult = { ok: true } | { ok: false; error: string; retryAt?: Date };

async function attemptDelivery(ref: NotificationRef, options: DeliveryOptions): Promise<DeliveryResult> {
  const [row] = await db.select({
    log: notificationLog, type: notificationChannels.type, target: notificationChannels.target,
    active: notificationChannels.active,
  }).from(notificationLog)
    .leftJoin(notificationChannels, and(eq(notificationChannels.id, notificationLog.channelId),
      eq(notificationChannels.workspaceId, notificationLog.workspaceId)))
    .where(identity(ref));
  if (!row) return { ok: false, error: "Notification was removed" };
  const { log } = row;
  if (log.status === "sent") return { ok: true };

  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const maxAttempts = log.event === "test" ? 1 : delays.length + 1;
  const dueAt = log.status === "processing" ? log.leaseUntil
    : ["pending", "retryable"].includes(log.status) ? log.nextAttemptAt : null;
  if (!dueAt || dueAt.getTime() > Date.now()) return { ok: false, error: log.error ?? DELIVERY_ERROR, retryAt: dueAt ?? undefined };

  const provider = row.type && row.target && (row.active || log.event === "test")
    ? await prepareDelivery(ref.workspaceId, { type: row.type, target: row.target }) : null;
  const now = new Date();
  const hadUncertainty = log.uncertainAttempt || log.status === "processing";
  const sameTransport = log.transportFingerprint === provider?.fingerprint;
  const canReplay = provider?.kind === "resend" && sameTransport && log.firstAttemptAt &&
    now.getTime() - log.firstAttemptAt.getTime() < RESEND_REPLAY_MS;
  const claimable = and(identity(ref), eq(notificationLog.attempts, log.attempts), due(now));
  const attemptLimit = log.event !== "test" && canReplay && log.status === "processing" ? maxAttempts + 1 : maxAttempts;
  if ((hadUncertainty && !canReplay) || log.attempts >= attemptLimit) {
    const error = hadUncertainty ? UNCERTAIN_ERROR : DELIVERY_ERROR;
    await db.update(notificationLog).set({
      status: hadUncertainty ? "uncertain" : "failed", error, leaseUntil: null, nextAttemptAt: null,
      uncertainAttempt: hadUncertainty,
    }).where(claimable);
    return { ok: false, error };
  }

  const [claimed] = await db.update(notificationLog).set({
    status: "processing", attempts: log.attempts + 1, nextAttemptAt: null,
    leaseUntil: new Date(now.getTime() + LEASE_MS),
    firstAttemptAt: sameTransport ? log.firstAttemptAt ?? now : now,
    transport: provider?.kind ?? null, transportFingerprint: provider?.fingerprint ?? null,
    uncertainAttempt: hadUncertainty,
  }).where(claimable).returning({ attempts: notificationLog.attempts });
  if (!claimed) return { ok: false, error: "Another worker has claimed this delivery." };

  const outcome = provider
    ? await sendMessage(provider, formatMessage(log.event as MessageEvent, log.payload as Record<string, unknown>), {
      idempotencyKey: log.id, timeoutMs: options.timeoutMs ?? 4_000,
    }) : "rejected";
  const activeAttempt = and(identity(ref), eq(notificationLog.attempts, claimed.attempts), eq(notificationLog.status, "processing"));

  // A failed database commit after provider acceptance must leave the attempt leased.
  if (outcome === "accepted") {
    const applied = await db.transaction(async (tx) => {
      const [saved] = await tx.update(notificationLog).set({
        status: "sent", error: null, sentAt: new Date(), leaseUntil: null, uncertainAttempt: false,
      }).where(activeAttempt).returning({ id: notificationLog.id });
      if (saved && log.urgentConversationId) await tx.update(urgentEvents).set({ sent: true })
        .where(and(eq(urgentEvents.workspaceId, ref.workspaceId), eq(urgentEvents.conversationId, log.urgentConversationId)));
      return Boolean(saved);
    });
    return applied ? { ok: true } : { ok: false, error: UNCERTAIN_ERROR };
  }

  const uncertain = hadUncertainty || outcome === "uncertain";
  const retry = claimed.attempts < maxAttempts && (!uncertain || provider?.kind === "resend");
  const retryAt = retry ? new Date(Date.now() + delays[claimed.attempts - 1]) : undefined;
  const error = uncertain ? UNCERTAIN_ERROR : DELIVERY_ERROR;
  await db.update(notificationLog).set({
    status: retry ? "retryable" : uncertain ? "uncertain" : "failed",
    nextAttemptAt: retryAt ?? null, leaseUntil: null, error, uncertainAttempt: uncertain,
  }).where(activeAttempt);
  return retryAt ? { ok: false, error, retryAt } : { ok: false, error };
}

/** The request can stop at any point. Another worker can resume due or expired attempts. */
export async function deliver(ref: NotificationRef, options: DeliveryOptions = {}): Promise<DeliveryResult> {
  let result = await attemptDelivery(ref, options);
  while (!options.once && !result.ok && result.retryAt) {
    const delay = result.retryAt.getTime() - Date.now();
    if (delay > ((options.delaysMs ?? RETRY_DELAYS_MS).at(-1) ?? 0)) break;
    await sleep(Math.max(0, delay));
    result = await attemptDelivery(ref, options);
  }
  return result;
}

export async function enqueue(
  workspaceId: string, event: MessageEvent, payload: NotificationPayload, dedupeKey: string,
  options: { connection?: Connection; urgentConversationId?: string; excludeEvent?: MessageEvent } = {},
) {
  const connection = options.connection ?? db;
  const channels = await connection.select().from(notificationChannels)
    .where(and(eq(notificationChannels.workspaceId, workspaceId), eq(notificationChannels.active, true)));
  const excluded = new Set(channels.filter((c) => options.excludeEvent && c.events.includes(options.excludeEvent))
    .map((c) => JSON.stringify([c.type, c.target.toLowerCase()])));
  const subscribed = channels.filter((c) => c.events.includes(event) && !excluded.has(JSON.stringify([c.type, c.target.toLowerCase()])));
  if (!subscribed.length) return [];

  return connection.insert(notificationLog).values(subscribed.map((c) => ({
    workspaceId, channelId: c.id, event, dedupeKey, payload: pickPayload(payload), urgentConversationId: options.urgentConversationId,
  }))).onConflictDoNothing().returning({ id: notificationLog.id, workspaceId: notificationLog.workspaceId });
}

export function queuedNotifications(workspaceId: string, dedupeKey: string) {
  return db.select({ id: notificationLog.id, workspaceId: notificationLog.workspaceId }).from(notificationLog)
    .where(and(eq(notificationLog.workspaceId, workspaceId), eq(notificationLog.dedupeKey, dedupeKey),
      inArray(notificationLog.status, ["pending", "retryable"])));
}

export async function deliverNotifications(rows: NotificationRef[], options?: DeliveryOptions) {
  return Promise.allSettled(rows.map((row) => deliver(row, options)));
}

export async function notify(workspaceId: string, event: MessageEvent, payload: NotificationPayload, dedupeKey: string) {
  return deliverNotifications(await enqueue(workspaceId, event, payload, dedupeKey));
}

export async function sweepNotifications() {
  const rows = await db.select({ id: notificationLog.id, workspaceId: notificationLog.workspaceId }).from(notificationLog)
    .where(due(new Date())).orderBy(
      sql`${notificationLog.urgentConversationId} is null`,
      asc(sql`coalesce(${notificationLog.nextAttemptAt}, ${notificationLog.leaseUntil})`),
    ).limit(20);
  const results = await deliverNotifications(rows, { once: true });
  return {
    examined: rows.length,
    sent: results.filter((result) => result.status === "fulfilled" && result.value.ok).length,
  };
}

/** The admin sees the result of a single immediate test. */
export async function sendTest(workspaceId: string, channelId: string) {
  const [channel] = await db.select().from(notificationChannels)
    .where(and(eq(notificationChannels.id, channelId), eq(notificationChannels.workspaceId, workspaceId)));
  if (!channel) return null;
  const [row] = await db.insert(notificationLog)
    .values({ workspaceId, channelId, event: "test", dedupeKey: `test:${crypto.randomUUID()}`, payload: {} })
    .returning({ id: notificationLog.id, workspaceId: notificationLog.workspaceId });
  return deliver(row);
}
