import { and, asc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import { erasedAppointmentTitle } from "@/lib/booking/event";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, assistantSyncs, deletionLog } from "@/lib/db/schema";
import { getWorkspaceCalendar, otherBusyEvents, readEvent, scrubEventDetails } from "@/lib/google/calendar";
import { resolveVapiAccount } from "@/lib/vapi/account";
import { VapiError, vapiFetch } from "@/lib/vapi/client";
import { privacyKey } from "./scope";
import type { GoogleEraseTarget, VapiEraseTarget } from "./targets";

type Task = typeof deletionLog.$inferSelect;
type Outcome = { status: "verified" } | { status: "manual" | "retryable"; errorCode: string };
const verified: Outcome = { status: "verified" };
const manual = (errorCode: string): Outcome => ({ status: "manual", errorCode });
const retry = (errorCode: string): Outcome => ({ status: "retryable", errorCode });
const active = (task: Task) => and(eq(deletionLog.workspaceId, task.workspaceId), eq(deletionLog.id, task.id),
  eq(deletionLog.status, "processing"), eq(deletionLog.attempts, task.attempts));
const providerTimeout = 4_000;
const missing = (status: number) => status === 404 || status === 410;

async function getCall(privateKey: string, path: string, signal: AbortSignal) {
  try {
    const value = await vapiFetch<{ id?: string; assistantId?: string }>(privateKey, path, { signal });
    if (!value || typeof value !== "object") throw new Error("Invalid Vapi call response");
    return value;
  } catch (error) {
    if (error instanceof VapiError && missing(error.status)) return null;
    throw error;
  }
}

// These are Vapi's authenticated artifact lookup endpoints. Never follow an artifact URL supplied by a webhook.
const media = ["mono", "stereo", "customer", "assistant", "video"];
async function callMediaGone(privateKey: string, path: string, signal: AbortSignal) {
  const responses = await Promise.all(media.map(async kind => {
    const response = await fetch(`https://api.vapi.ai${path}/${kind}-recording`, {
      headers: { Authorization: `Bearer ${privateKey}` }, redirect: "manual", cache: "no-store", signal,
    });
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new VapiError("Vapi recording lookup denied", response.status);
    return response.status;
  }));
  return responses.every(missing);
}

async function eraseVapi(task: Task, target: VapiEraseTarget): Promise<Outcome> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target.callId)) return manual("vapi_call_id_invalid");
  const account = await resolveVapiAccount(task.workspaceId).catch(() => null);
  if (!account) return retry("vapi_connection_required");
  const { privateKey } = account;
  const credential = privacyKey(task.workspaceId, "vapi-credential", privateKey);
  const path = `/call/${encodeURIComponent(target.callId)}`;
  const signal = AbortSignal.timeout(providerTimeout);
  const call = await getCall(privateKey, path, signal);
  if (call === null && target.verifiedCredential !== credential) return manual("vapi_absence_unverified");
  if (call !== null) {
    if (call?.id !== target.callId || !call.assistantId || target.assistantIds.length > 1 ||
      (target.assistantIds.length === 1 && target.assistantIds[0] !== call.assistantId)) {
      return manual("vapi_ownership_unverified");
    }
    const mappings = await db.selectDistinct({ workspaceId: assistantSyncs.workspaceId }).from(assistantSyncs)
      .where(or(eq(assistantSyncs.vapiAssistantId, call.assistantId), eq(assistantSyncs.replacementVapiAssistantId, call.assistantId)));
    if (mappings.some(row => row.workspaceId !== task.workspaceId) || (!target.assistantIds.length && !mappings.length)) {
      return manual("vapi_ownership_unverified");
    }
    // Checkpoint before DELETE, so a lost response can be resolved using the same verified account.
    const [saved] = await db.update(deletionLog)
      .set({ targetEncrypted: encrypt(JSON.stringify({ ...target, verifiedCredential: credential })) })
      .where(active(task)).returning({ id: deletionLog.id });
    if (!saved) return retry("vapi_lease_lost");
    try {
      await vapiFetch(privateKey, path, { method: "DELETE", body: {}, signal });
    } catch (error) {
      if (!(error instanceof VapiError && missing(error.status))) throw error;
    }
    if (await getCall(privateKey, path, signal) !== null) return retry("vapi_call_still_present");
  }

  return await callMediaGone(privateKey, path, signal) ? verified : retry("vapi_media_unverified");
}

async function eraseGoogle(task: Task, target: GoogleEraseTarget): Promise<Outcome> {
  const { appointmentId, calendarId, eventId, periods } = target;
  const calendar = await getWorkspaceCalendar(task.workspaceId).catch(() => null);
  if (!calendar) return retry("google_connection_required");

  // Check the mapping even when workspaces use the same Google calendar or account.
  const [otherOwner] = await db.select({ id: appointments.id }).from(appointments)
    .where(and(eq(appointments.googleEventId, eventId), eq(appointments.googleCalendarId, calendarId),
      or(ne(appointments.workspaceId, task.workspaceId), ne(appointments.id, appointmentId)))).limit(1);
  if (otherOwner) return manual("google_ownership_unverified");

  const connected = { ...calendar, calendarId, deadline: AbortSignal.timeout(providerTimeout) };
  const event = await readEvent(connected, eventId);
  if (!event) {
    // Google can hide a missing or inaccessible calendar behind an event-level 404.
    await otherBusyEvents(connected, new Date(periods[0].start), new Date(periods[0].end), eventId);
    return verified;
  }
  const marker = event.extendedProperties?.private?.incodetAppointment;
  if (marker !== `${task.workspaceId}:${appointmentId}`) {
    const [recorded] = await db.select({
      startAt: appointments.startAt, endAt: appointments.endAt,
      targetStart: appointments.targetStart, targetEnd: appointments.targetEnd,
    }).from(appointments)
      .where(and(eq(appointments.workspaceId, task.workspaceId), eq(appointments.id, appointmentId),
        eq(appointments.googleEventId, eventId), eq(appointments.googleCalendarId, calendarId)));
    const eventStart = Date.parse(event.start?.dateTime ?? "");
    const eventEnd = Date.parse(event.end?.dateTime ?? "");
    // A hub reschedule can finish after erasure queued the scrub.
    const currentPeriods = [[recorded?.startAt, recorded?.endAt], [recorded?.targetStart, recorded?.targetEnd]];
    const intervalMatches = currentPeriods.some(([start, end]) =>
      start?.getTime() === eventStart && end?.getTime() === eventEnd)
      || periods.some(({ start, end }) => Date.parse(start) === eventStart && Date.parse(end) === eventEnd);
    if (marker || !recorded || !intervalMatches || event.recurringEventId || event.recurrence?.length) {
      return manual("google_ownership_unverified");
    }
  }
  if (event.summary === erasedAppointmentTitle && !event.description) return verified;
  await scrubEventDetails(connected, eventId, event.etag!, erasedAppointmentTitle);
  const cleaned = await readEvent(connected, eventId);
  return cleaned?.summary === erasedAppointmentTitle && !cleaned.description ? verified : retry("google_scrub_unverified");
}

const due = (now: Date) => or(
  and(inArray(deletionLog.status, ["pending", "retryable"]), lte(deletionLog.nextAttemptAt, now)),
  and(eq(deletionLog.status, "processing"), lte(deletionLog.leaseUntil, now)),
);

function safeError(kind: "vapi" | "google", error: unknown) {
  const code = error instanceof VapiError ? error.status : (error as { response?: { status?: number } })?.response?.status;
  if (code === 401 || code === 403) return `${kind}_authorization_failed`;
  if (code === 412) return `${kind}_changed_during_request`;
  return `${kind}_request_failed`;
}

async function processDeletion(workspaceId: string, id: string) {
  const now = new Date();
  const [task] = await db.update(deletionLog).set({
    status: "processing", attempts: sql`${deletionLog.attempts} + 1`, nextAttemptAt: null,
    leaseUntil: new Date(now.getTime() + 30_000),
  }).where(and(eq(deletionLog.workspaceId, workspaceId), eq(deletionLog.id, id), due(now))).returning();
  if (!task || task.kind === "local") return;
  let outcome: Outcome;
  if (!task.targetEncrypted) outcome = manual("provider_locator_missing");
  else {
    try {
      const target = JSON.parse(decrypt(task.targetEncrypted)) as VapiEraseTarget & GoogleEraseTarget;
      outcome = task.kind === "vapi" ? await eraseVapi(task, target) : await eraseGoogle(task, target);
    } catch (error) {
      outcome = retry(safeError(task.kind, error));
    }
  }
  const verifiedAt = outcome.status === "verified" ? new Date() : null;
  const delayMinutes = Math.min(24 * 60, 2 ** Math.min(11, task.attempts - 1));
  await db.update(deletionLog).set({
    status: outcome.status, leaseUntil: null, verifiedAt,
    ...(verifiedAt ? { targetEncrypted: null } : {}),
    errorCode: outcome.status === "verified" ? null : outcome.errorCode,
    nextAttemptAt: outcome.status === "retryable" ? new Date(Date.now() + delayMinutes * 60_000) : null,
  }).where(active(task));
  return outcome.status;
}

export async function sweepProviderDeletions() {
  const rows = await db.select({ id: deletionLog.id, workspaceId: deletionLog.workspaceId }).from(deletionLog)
    .where(due(new Date())).orderBy(asc(deletionLog.createdAt)).limit(10);
  const outcomes = await Promise.allSettled(rows.map(row => processDeletion(row.workspaceId, row.id)));
  return {
    examined: rows.length,
    verified: outcomes.filter(result => result.status === "fulfilled" && result.value === "verified").length,
    manual: outcomes.filter(result => result.status === "fulfilled" && result.value === "manual").length,
  };
}
