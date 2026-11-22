import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { workingShift, type WorkingHours } from "@/lib/booking/slots";
import { db } from "@/lib/db/client";
import { calendars, conversations, urgentEvents, workspaces } from "@/lib/db/schema";

export function onCallNumber(
  now: DateTime, hours: WorkingHours, primary: string, backup: string,
) {
  const shifts = [workingShift(hours, now), workingShift(hours, now.minus({ days: 1 }))];
  return shifts.some(shift => shift && now >= shift.start && now < shift.end) ? primary : backup;
}

export async function transferDestination(workspaceId: string, callId: string) {
  const [row] = await db.select({
    enabled: workspaces.transferEnabled, status: workspaces.status, timezone: workspaces.timezone,
    primary: workspaces.onCallNumber, backup: workspaces.backupNumber, hours: calendars.workingHours,
  }).from(workspaces).leftJoin(calendars, eq(calendars.workspaceId, workspaces.id))
    .where(eq(workspaces.id, workspaceId));
  if (!row?.enabled || row.status !== "active") return null;
  const [urgent] = await db.select({ sent: urgentEvents.sent }).from(urgentEvents)
    .innerJoin(conversations, and(eq(conversations.id, urgentEvents.conversationId), eq(conversations.workspaceId, workspaceId)))
    .where(and(eq(urgentEvents.workspaceId, workspaceId), eq(conversations.externalId, callId)));
  if (!urgent?.sent) return null;
  const number = onCallNumber(DateTime.now().setZone(row.timezone), (row.hours ?? {}) as WorkingHours, row.primary, row.backup);
  return number ? { type: "number" as const, number } : null;
}
