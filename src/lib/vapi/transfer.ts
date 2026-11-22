import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import type { WorkingHours } from "@/lib/booking/slots";
import { db } from "@/lib/db/client";
import { calendars, workspaces } from "@/lib/db/schema";

export function onCallNumber(
  now: DateTime, hours: WorkingHours, primary: string, backup: string,
) {
  const day = now.setLocale("en").toFormat("ccc").toLowerCase();
  const shift = hours[day];
  const time = now.toFormat("HH:mm");
  return shift && time >= shift.open && time < shift.close ? primary : backup;
}

export async function transferDestination(workspaceId: string) {
  const [row] = await db.select({
    enabled: workspaces.transferEnabled, status: workspaces.status, timezone: workspaces.timezone,
    primary: workspaces.onCallNumber, backup: workspaces.backupNumber, hours: calendars.workingHours,
  }).from(workspaces).leftJoin(calendars, eq(calendars.workspaceId, workspaces.id))
    .where(eq(workspaces.id, workspaceId));
  if (!row?.enabled || row.status !== "active") return null;
  const number = onCallNumber(DateTime.now().setZone(row.timezone), (row.hours ?? {}) as WorkingHours, row.primary, row.backup);
  return number ? { type: "number" as const, number } : null;
}
