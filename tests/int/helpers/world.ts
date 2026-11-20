import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { calendars, services, workspaces } from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";

const API = "https://www.googleapis.com/calendar/v3";
const day = { open: "09:00", close: "17:00" };
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, day]));

/** Mutable state behind the mocked Google endpoints. */
export const google = {
  busy: [] as { start: string; end: string }[],
  failInsert: false,
  failFreeBusy: false,
  calls: [] as string[],
  eventCount: 0,
  lastEvent: null as { summary?: string; description?: string } | null,
};

export const googleServer = setupServer(
  http.post("https://oauth2.googleapis.com/token", () =>
    HttpResponse.json({ access_token: "at", expires_in: 3600, token_type: "Bearer" }),
  ),
  http.post(`${API}/freeBusy`, () => {
    if (google.failFreeBusy) return HttpResponse.json({ error: { message: "down" } }, { status: 500 });
    return HttpResponse.json({ calendars: { cal1: { busy: google.busy } } });
  }),
  http.post(`${API}/calendars/cal1/events`, async ({ request }) => {
    google.calls.push("insert");
    google.lastEvent = (await request.clone().json()) as typeof google.lastEvent;
    if (google.failInsert) return HttpResponse.json({ error: { message: "boom" } }, { status: 500 });
    return HttpResponse.json({ id: `evt-${++google.eventCount}` });
  }),
  http.patch(`${API}/calendars/cal1/events/:id`, ({ params }) => {
    google.calls.push(`patch ${params.id}`);
    return HttpResponse.json({ id: params.id });
  }),
  http.delete(`${API}/calendars/cal1/events/:id`, ({ params }) => {
    google.calls.push(`delete ${params.id}`);
    return new HttpResponse(null, { status: 204 });
  }),
);

/** Call after the first database query: with MSW active first, the Postgres socket fails with ENOTCONN. */
export const startGoogle = () => googleServer.listen({ onUnhandledFrame: "error" });

export function resetGoogle() {
  Object.assign(google, { busy: [], failInsert: false, failFreeBusy: false, calls: [], eventCount: 0, lastEvent: null });
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
