import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { google } from "googleapis";
import type { Interval } from "@/lib/booking/slots";
import { db } from "@/lib/db/client";
import { calendars, workspaces } from "@/lib/db/schema";
import { getExactIntegration } from "@/lib/integrations/store";
import { oauthClient } from "./oauth";

export type CalendarSummary = { id: string; summary: string; timeZone: string | null; primary: boolean };
export type CalendarTarget = { workspaceId: string; calendarId: string; refreshToken: string };
export type WorkspaceCalendar = CalendarTarget & { timezone: string; row: typeof calendars.$inferSelect };
type BusyCache = { from: string; to: string; busy: Interval[] };

const CACHE_MS = 60_000;

function client(refreshToken: string) {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

function statusOf(error: unknown) {
  const e = error as { response?: { status?: number }; code?: number };
  return e.response?.status ?? e.code;
}

export async function listCalendars(refreshToken: string): Promise<CalendarSummary[]> {
  const { data } = await client(refreshToken).calendarList.list({ maxResults: 250 });
  return (data.items ?? [])
    .filter((c) => c.id && c.accessRole !== "reader" && c.accessRole !== "freeBusyReader")
    .map((c) => ({
      id: c.id as string,
      summary: c.summary ?? (c.id as string),
      timeZone: c.timeZone ?? null,
      primary: Boolean(c.primary),
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary));
}

/** The workspace's connected calendar, or a sentence explaining what is missing. */
export async function getWorkspaceCalendar(workspaceId: string): Promise<WorkspaceCalendar> {
  const [[row], integration, [workspace]] = await Promise.all([
    db.select().from(calendars).where(eq(calendars.workspaceId, workspaceId)),
    getExactIntegration("google", workspaceId),
    db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)),
  ]);
  const refreshToken = integration?.creds.refreshToken;
  if (!row?.googleCalendarId || !refreshToken) throw new Error("Google Calendar is not connected");
  if (!workspace) throw new Error("Workspace not found");
  return { workspaceId, calendarId: row.googleCalendarId, refreshToken, timezone: workspace.timezone, row };
}

export async function getBusy(
  calendar: CalendarTarget,
  from: DateTime,
  to: DateTime,
  options: { fresh?: boolean } = {},
): Promise<Interval[]> {
  const [row] = await db
    .select({ cache: calendars.busyCache, at: calendars.busyCachedAt })
    .from(calendars)
    .where(eq(calendars.workspaceId, calendar.workspaceId));
  const cache = row?.cache as BusyCache | null;
  if (
    !options.fresh &&
    cache &&
    row?.at &&
    Date.now() - row.at.getTime() < CACHE_MS &&
    Date.parse(cache.from) <= from.toMillis() &&
    Date.parse(cache.to) >= to.toMillis()
  ) {
    return cache.busy;
  }

  const { data } = await client(calendar.refreshToken).freebusy.query({
    requestBody: {
      timeMin: from.toUTC().toISO() ?? undefined,
      timeMax: to.toUTC().toISO() ?? undefined,
      items: [{ id: calendar.calendarId }],
    },
  });
  const busy = (data.calendars?.[calendar.calendarId]?.busy ?? []).flatMap((b) =>
    b.start && b.end ? [{ start: b.start, end: b.end }] : [],
  );
  await db
    .update(calendars)
    .set({
      busyCache: { from: from.toISO(), to: to.toISO(), busy },
      busyCachedAt: new Date(),
    })
    .where(eq(calendars.workspaceId, calendar.workspaceId));
  return busy;
}

export async function createEvent(
  calendar: CalendarTarget,
  input: { summary: string; description?: string; start: DateTime; end: DateTime; timezone: string },
) {
  const { data } = await client(calendar.refreshToken).events.insert({
    calendarId: calendar.calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISO() ?? undefined, timeZone: input.timezone },
      end: { dateTime: input.end.toISO() ?? undefined, timeZone: input.timezone },
    },
  });
  if (!data.id) throw new Error("Google Calendar did not return an event id");
  return data.id;
}

export async function moveEvent(
  calendar: CalendarTarget,
  eventId: string,
  input: { start: DateTime; end: DateTime; timezone: string },
) {
  await client(calendar.refreshToken).events.patch({
    calendarId: calendar.calendarId,
    eventId,
    requestBody: {
      start: { dateTime: input.start.toISO() ?? undefined, timeZone: input.timezone },
      end: { dateTime: input.end.toISO() ?? undefined, timeZone: input.timezone },
    },
  });
}

/** A missing event is already deleted. */
export async function deleteEvent(calendar: CalendarTarget, eventId: string) {
  try {
    await client(calendar.refreshToken).events.delete({ calendarId: calendar.calendarId, eventId });
  } catch (error) {
    const status = statusOf(error);
    if (status !== 404 && status !== 410) throw error;
  }
}
