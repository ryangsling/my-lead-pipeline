import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { encrypt } from "@/lib/crypto";
import { client, db } from "@/lib/db/client";
import { calendars, services, workspaces } from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";

const API = "https://www.googleapis.com/calendar/v3";
const day = { open: "09:00", close: "17:00" };
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, day]));

export type MockEvent = {
  id: string; etag: string; summary?: string; description?: string;
  start: { dateTime: string }; end: { dateTime: string };
};
const events = new Map<string, MockEvent>();
const tombstones = new Set<string>();
const overlaps = (start: string, end: string, from: string, to: string) =>
  Date.parse(start) < Date.parse(to) && Date.parse(end) > Date.parse(from);
const missing = () => HttpResponse.json({}, { status: 404 });
const down = () => HttpResponse.json({}, { status: 503 });

/** Mutable state behind the mocked Google endpoints. */
export const google = {
  busy: [] as { start: string; end: string }[],
  failInsert: false,
  failFreeBusy: false,
  calls: [] as string[],
  events,
  loseInsertResponse: false,
  insertResponseDelayMs: 0,
  losePatchResponse: false,
  loseDeleteResponse: false,
  conflictAfterWrite: false,
  lastEvent: null as { summary?: string; description?: string } | null,
};

export const googleServer = setupServer(
  http.post("https://oauth2.googleapis.com/token", () =>
    HttpResponse.json({ access_token: "at", expires_in: 3600, token_type: "Bearer" }),
  ),
  http.post(`${API}/freeBusy`, async ({ request }) => {
    if (google.failFreeBusy) return down();
    const { timeMin, timeMax } = await request.json() as { timeMin: string; timeMax: string };
    const busy = google.busy.filter(b => overlaps(b.start, b.end, timeMin, timeMax));
    return HttpResponse.json({ calendars: { cal1: { busy } } });
  }),
  http.get(`${API}/calendars/cal1/events`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const from = q.get("timeMin")!, to = q.get("timeMax")!;
    const items = [...events.values()].filter(e => overlaps(e.start.dateTime, e.end.dateTime, from, to));
    const external = google.busy.filter(b => overlaps(b.start, b.end, from, to)).map((b, i) => ({
      id: `external${i}`, start: { dateTime: b.start }, end: { dateTime: b.end },
    }));
    return HttpResponse.json({ items: [...items, ...external] });
  }),
  http.get(`${API}/calendars/cal1/events/:id`, ({ params }) => {
    const event = events.get(String(params.id));
    return event ? HttpResponse.json(event) : missing();
  }),
  http.post(`${API}/calendars/cal1/events`, async ({ request }) => {
    google.calls.push("insert");
    const event = await request.json() as MockEvent;
    google.lastEvent = event;
    if (google.failInsert) return down();
    if (events.has(event.id) || tombstones.has(event.id)) return HttpResponse.json({}, { status: 409 });
    const saved = { ...event, etag: '"1"' };
    events.set(event.id, saved);
    if (google.conflictAfterWrite) google.busy.push({ start: event.start.dateTime, end: event.end.dateTime });
    if (google.loseInsertResponse) return HttpResponse.error();
    if (google.insertResponseDelayMs) await delay(google.insertResponseDelayMs);
    return HttpResponse.json(saved);
  }),
  http.patch(`${API}/calendars/cal1/events/:id`, async ({ params, request }) => {
    google.calls.push(`patch ${params.id}`);
    const event = events.get(String(params.id));
    if (!event) return missing();
    if (event.etag !== request.headers.get("if-match")) return HttpResponse.json({}, { status: 412 });
    Object.assign(event, await request.json(), { etag: `"${crypto.randomUUID()}"` });
    if (google.conflictAfterWrite) {
      google.busy.push({ start: event.start.dateTime, end: event.end.dateTime });
      google.conflictAfterWrite = false;
    }
    return google.losePatchResponse ? HttpResponse.error() : HttpResponse.json(event);
  }),
  http.delete(`${API}/calendars/cal1/events/:id`, ({ params, request }) => {
    google.calls.push(`delete ${params.id}`);
    const event = events.get(String(params.id));
    if (!event) return missing();
    if (event.etag !== request.headers.get("if-match")) return HttpResponse.json({}, { status: 412 });
    events.delete(event.id);
    tombstones.add(event.id);
    return google.loseDeleteResponse ? HttpResponse.error() : new HttpResponse(null, { status: 204 });
  }),
);

/** Open every PostgreSQL socket before MSW installs its Node network interceptor. */
export async function startGoogle() {
  const connections = await Promise.all(Array.from({ length: client.options.max }, () => client.reserve()));
  for (const connection of connections) connection.release();
  googleServer.listen({ onUnhandledFrame: "error" });
}

export function resetGoogle() {
  events.clear();
  tombstones.clear();
  Object.assign(google, { loseInsertResponse: false, insertResponseDelayMs: 0, loseDeleteResponse: false, losePatchResponse: false, conflictAfterWrite: false, busy: [], failInsert: false, failFreeBusy: false, calls: [], lastEvent: null });
}

/** Empty database, one connected Bloom-like workspace open 09:00-17:00 every day, and a 60-minute service. */
export async function seedWorld() {
  resetGoogle();
  await db.execute(sql`truncate workspaces cascade`);
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: "bloom", name: "Bloom", timezone: "Europe/London", country: "GB", webhookSecretEncrypted: encrypt("secret") })
    .returning();
  await db.insert(calendars).values({
    workspaceId: ws.id,
    googleCalendarId: "cal1",
    workingHours: hours,
    slotStepMin: 30,
    minNoticeHours: 0,
    maxDaysAhead: 30,
  });
  await saveIntegration("google", ws.id, { refreshToken: "rt" }, {});
  const [svc] = await db.insert(services).values({ workspaceId: ws.id, name: "Cut", durationMin: 60, bufferMin: 0 }).returning();
  return { workspaceId: ws.id, serviceId: svc.id };
}

/** A slot start `daysAhead` days from now at `hour` o'clock, London time. */
export const slot = (daysAhead: number, hour: number) =>
  DateTime.now().setZone("Europe/London").plus({ days: daysAhead }).set({ hour, minute: 0, second: 0, millisecond: 0 });
