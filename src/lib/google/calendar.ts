import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { google } from "googleapis";
import type { Interval } from "@/lib/booking/slots";
import { db } from "@/lib/db/client";
import { calendars, workspaces } from "@/lib/db/schema";
import { getExactIntegration } from "@/lib/integrations/store";
import { oauthClient } from "./oauth";

export type CalendarSummary = { id: string; summary: string; timeZone: string | null; primary: boolean };
export type CalendarTarget = { workspaceId: string; calendarId: string; api: () => ReturnType<typeof client> };
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
export async function getWorkspaceCalendar(workspaceId: string, timezone?: string): Promise<WorkspaceCalendar> {
  const [[row], integration, [workspace]] = await Promise.all([
    db.select().from(calendars).where(eq(calendars.workspaceId, workspaceId)),
    getExactIntegration("google", workspaceId),
    timezone ? [{ timezone }] : db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)),
  ]);
  const refreshToken = integration?.creds.refreshToken;
  if (!row?.googleCalendarId || !refreshToken) throw new Error("Google Calendar is not connected");
  if (!workspace) throw new Error("Workspace not found");
  let api: ReturnType<typeof client> | undefined;
  return { workspaceId, calendarId: row.googleCalendarId, api: () => api ??= client(refreshToken), timezone: workspace.timezone, row };
}

export async function getBusy(
  calendar: WorkspaceCalendar,
  from: DateTime,
  to: DateTime,
  options: { fresh?: boolean } = {},
): Promise<Interval[]> {
  const { row } = calendar;
  const cache = options.fresh ? null : row.busyCache as BusyCache | null;
  if (
    !options.fresh &&
    cache &&
    row.busyCachedAt &&
    Date.now() - row.busyCachedAt.getTime() < CACHE_MS &&
    Date.parse(cache.from) <= from.toMillis() &&
    Date.parse(cache.to) >= to.toMillis()
  ) {
    return cache.busy;
  }

  const signal = AbortSignal.timeout(900);
  const query = calendar.api().freebusy.query({
    requestBody: {
      timeMin: from.toUTC().toISO() ?? undefined,
      timeMax: to.toUTC().toISO() ?? undefined,
      items: [{ id: calendar.calendarId }],
    },
  }, { signal, retry: false });
  // OAuth token acquisition also counts against the voice deadline.
  const deadline = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const { data } = await Promise.race([query, deadline]);
  const entry = data.calendars?.[calendar.calendarId];
  if (!entry || (entry.errors !== undefined && !(Array.isArray(entry.errors) && entry.errors.length === 0)) || !Array.isArray(entry.busy)) {
    throw new Error("Calendar availability could not be verified");
  }
  const busy = entry.busy.map(({ start, end }) => {
    if (!start || !end || !(DateTime.fromISO(start).toMillis() < DateTime.fromISO(end).toMillis())) {
      throw new Error("Invalid calendar busy interval");
    }
    return { start, end };
  });
  const busyCache = { from: from.toISO(), to: to.toISO(), busy };
  const busyCachedAt = new Date();
  await db
    .update(calendars)
    .set({ busyCache, busyCachedAt })
    .where(eq(calendars.workspaceId, calendar.workspaceId));
  Object.assign(row, { busyCache, busyCachedAt });
  return busy;
}

export async function createEvent(
  calendar: CalendarTarget,
  input: { summary: string; description?: string; start: DateTime; end: DateTime; timezone: string },
) {
  const { data } = await calendar.api().events.insert({
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
  await calendar.api().events.patch({
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
    await calendar.api().events.delete({ calendarId: calendar.calendarId, eventId });
  } catch (error) {
    const status = statusOf(error);
    if (status !== 404 && status !== 410) throw error;
  }
}
