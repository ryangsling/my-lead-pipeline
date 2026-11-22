import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Settings } from "luxon";
import { http, HttpResponse } from "msw";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { appointments, calendars, contacts, conversations, embeds, jobs, notificationChannels, notificationLog, services, workspaces } from "@/lib/db/schema";
import { publicBookingLimits } from "@/lib/booking/public-rate-limit";
import { reconcilePendingAppointments } from "@/lib/booking/reconcile";
import { saveIntegration } from "@/lib/integrations/store";
import { google, googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

const pending = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
const ingress = vi.hoisted(() => ({ header: "x-public-booking-client-ip" as "x-public-booking-client-ip" | undefined }));
vi.mock("@/lib/env", async original => {
  const { env } = await original<typeof import("@/lib/env")>();
  return { env: { ...env, get PUBLIC_BOOKING_TRUSTED_IP_HEADER() { return ingress.header; } } };
});
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => void pending.push(fn),
}));

const slotsRoute = await import("@/app/api/public/[pk]/slots/route");
const bookRoute = await import("@/app/api/public/[pk]/book/route");

const PK = "pk_test_bloom";
let workspaceId: string;
let serviceId: string;

const ctx = (pk: string) => ({ params: Promise.resolve({ pk }) }) as never;
const getSlots = (pk = PK, query = "") =>
  slotsRoute.GET(new Request(`http://localhost/api/public/${pk}/slots?serviceId=${serviceId}${query}`), ctx(pk));
const postBooking = (body: Record<string, unknown>, pk = PK, headers?: HeadersInit) =>
  bookRoute.POST(new Request(`http://localhost/api/public/${pk}/book`, { method: "POST", body: JSON.stringify(body), headers }), ctx(pk));
const fromClient = (ip: string) => ({ "x-public-booking-client-ip": ip });
const drain = () => Promise.all(pending.splice(0).map((fn) => fn()));
const book = async (body: Record<string, unknown>, pk = PK) => {
  const res = await postBooking(body, pk);
  await drain();
  return res;
};
const details = (start: string, extra: Record<string, unknown> = {}) => ({
  serviceId,
  start,
  name: "Ada Lovelace",
  phone: "07700 900123",
  ...extra,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  ingress.header = "x-public-booking-client-ip";
  googleServer.resetHandlers();
  ({ workspaceId, serviceId } = await seedWorld());
  await db.insert(embeds).values({ workspaceId, publicKey: PK });
});

describe("public slots", () => {
  it("lists open slots with the workspace timezone, without a login", async () => {
    const res = await getSlots();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timezone).toBe("Europe/London");
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0]).toEqual({ start: expect.any(String), end: expect.any(String) });
  });

  it("returns 404 for an unknown key and for an archived workspace", async () => {
    expect((await getSlots("pk_nope")).status).toBe(404);
    await db.update(workspaces).set({ status: "archived" }).where(eq(workspaces.id, workspaceId));
    expect((await getSlots()).status).toBe(404);
  });

  it("rejects a bad service id", async () => {
    const res = await slotsRoute.GET(new Request(`http://localhost/api/public/${PK}/slots?serviceId=nope`), ctx(PK));
    expect(res.status).toBe(422);
  });

  it("distinguishes both repeated 1:30 slots and books the occurrence chosen from the public list", async () => {
    await db.update(workspaces).set({ timezone: "America/New_York" }).where(eq(workspaces.id, workspaceId));
    await db.update(calendars).set({ workingHours: { sat: { open: "20:00", close: "06:00" } } })
      .where(eq(calendars.workspaceId, workspaceId));
    await db.update(services).set({ durationMin: 30 }).where(eq(services.id, serviceId));
    const clock = vi.spyOn(Settings, "now").mockReturnValue(Date.parse("2027-11-07T04:00:00Z"));
    try {
      const res = await getSlots(PK, "&from=2027-11-07&to=2027-11-07");
      expect(res.status).toBe(200);
      const { slots } = await res.json() as { slots: { start: string; end: string; repeatedTimeOffset?: string }[] };
      const repeated = slots.filter(s => s.start.startsWith("2027-11-07T01:30:"));
      expect(repeated).toEqual([
        { start: "2027-11-07T01:30:00-04:00", end: "2027-11-07T01:00:00-05:00", repeatedTimeOffset: "UTC-04:00" },
        { start: "2027-11-07T01:30:00-05:00", end: "2027-11-07T02:00:00-05:00", repeatedTimeOffset: "UTC-05:00" },
      ]);
      const chosen = repeated[1];
      const booked = await book(details(chosen.start));
      expect(booked.status).toBe(201);
      const [appointment] = await db.select().from(appointments);
      expect(appointment.startAt.toISOString()).toBe("2027-11-07T06:30:00.000Z");
      expect(google.events.get(appointment.googleEventId!)?.start.dateTime).toBe("2027-11-07T06:30:00.000Z");

      await db.update(calendars).set({ publicBookingRequestOnly: true }).where(eq(calendars.workspaceId, workspaceId));
      expect((await book(details(repeated[0].start))).status).toBe(202);
      const [lead] = await db.select().from(conversations);
      expect(lead.structured).toMatchObject({ preferred_time: expect.stringContaining("01:30 (UTC-04:00)") });
    } finally { clock.mockRestore(); }
  });
});

describe("public book", () => {
  it("books, creates the contact and removes the slot from the list", async () => {
    const start = slot(2, 10).toISO({ suppressMilliseconds: true }) as string;
    const res = await book(details(start, { zip: "01234", address: "123 Example Road" }));
    expect((await db.select().from(jobs))[0]).toMatchObject({ zip: "01234", address: "123 Example Road", timezone: "Europe/London" });
    expect(res.status).toBe(201);
    expect((await res.json()).reference).toMatch(/^[0-9A-F]{8}$/);
    expect(await db.select().from(appointments)).toHaveLength(1);
    expect((await db.select().from(contacts))[0]).toMatchObject({ phoneE164: "+447700900123", source: "form" });

    const after = await (await getSlots(PK, `&from=${slot(2, 10).toISODate()}&to=${slot(2, 10).toISODate()}`)).json();
    expect(after.slots.map((s: { start: string }) => s.start)).not.toContain(start);
  });

  it("confirms separate valid requests with distinct appointments, contacts and Google events", async () => {
    const responses = await Promise.all([
      postBooking(details(slot(2, 10).toISO()!)),
      postBooking(details(slot(2, 12).toISO()!, { name: "Grace", phone: "07700 900456" })),
    ]);
    await drain();
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    const rows = await db.select().from(appointments);
    const people = await db.select().from(contacts);
    expect(rows).toHaveLength(2);
    expect(people).toHaveLength(2);
    expect(new Set(rows.map(a => a.contactId))).toEqual(new Set(people.map(c => c.id)));
    expect(new Set(rows.map(a => a.googleEventId))).toEqual(new Set(google.events.keys()));
    expect([...google.events.values()].map(event => event.summary)).toEqual(expect.arrayContaining(["Cut - Ada Lovelace", "Cut - Grace"]));
  });

  it("reports an uncertain booking as pending and recovers its Google event and job details", async () => {
    google.loseInsertResponse = true;
    const response = await book(details(slot(2, 10).toISO()!, { address: "12 Main Street", zip: "01234" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending", message: expect.stringContaining("awaiting confirmation") });
    const [row] = await db.select().from(appointments);
    expect(row.status).toBe("pending");
    expect(row.contactId).toBeNull();
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(google.events.has(row.googleEventId!)).toBe(true);
    await db.update(appointments).set({ reconcileAt: new Date(0) }).where(eq(appointments.id, row.id));
    expect(await reconcilePendingAppointments()).toEqual({ examined: 1, pending: 0 });
    const [contact] = await db.select().from(contacts);
    expect(contact.phoneE164).toBe("+447700900123");
    expect((await db.select().from(appointments))[0]).toMatchObject({ status: "booked", googleEventId: row.googleEventId, contactId: contact.id });
    expect((await db.select().from(jobs))[0]).toMatchObject({ appointmentId: row.id, address: "12 Main Street", zip: "01234", contactId: contact.id });
    expect(google.events.size).toBe(1);
  });

  it("keeps the public booking and Google event if the queued notification transport fails", async () => {
    const attempted: string[] = [];
    await saveIntegration("telegram", null, { botToken: "notification-test" }, {});
    await db.insert(notificationChannels).values({
      workspaceId, type: "telegram", target: "12345", events: ["booking_new"],
    });
    googleServer.use(http.post("https://api.telegram.org/botnotification-test/sendMessage", async ({ request }) => {
      const body = await request.json() as { chat_id: string };
      attempted.push(body.chat_id);
      return HttpResponse.error();
    }));
    const res = await postBooking(details(slot(2, 10).toISO()!));
    expect(res.status).toBe(201);
    const { appointment } = await res.json();
    const [row] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    expect(row.status).toBe("booked");
    expect(google.events.has(row.googleEventId!)).toBe(true);
    expect(attempted).toHaveLength(0);
    expect(await db.select().from(notificationLog).where(eq(notificationLog.workspaceId, workspaceId))).toMatchObject([
      { event: "booking_new", status: "pending", attempts: 0 },
    ]);
    await drain();
    expect(await db.select().from(notificationLog).where(eq(notificationLog.workspaceId, workspaceId))).toMatchObject([
      { event: "booking_new", status: "uncertain", attempts: 1, dedupeKey: `booking_new:${row.id}` },
    ]);
    expect(attempted).toEqual(["12345"]);
    expect(await db.select().from(appointments).where(eq(appointments.id, appointment.id))).toMatchObject([{ status: "booked" }]);
    expect(google.events.size).toBe(1);
  });

  it("answers 409 when the slot is taken without inserting or updating contacts", async () => {
    const start = slot(2, 10).toISO({ suppressMilliseconds: true }) as string;
    await book(details(start));
    const second = await book(details(start, { name: "Grace", phone: "07700 900456" }));
    expect(second.status).toBe(409);
    const withEmail = await book(details(start, { email: "new@example.com" }));
    expect(withEmail.status).toBe(409);
    expect(await db.select().from(appointments)).toHaveLength(1);
    expect(await db.select().from(contacts)).toMatchObject([{ name: "Ada Lovelace", email: null }]);
    expect(google.events.size).toBe(1);
  });

  it("refuses inactive or unknown services, a time outside working hours, and Google busy time without contacts", async () => {
    const start = slot(2, 10).toISO()!;
    const [inactive] = await db.insert(services).values({ workspaceId, name: "Inactive", durationMin: 60, active: false }).returning();
    expect((await book(details(start, { serviceId: inactive.id }))).status).toBe(409);
    expect((await book(details(start, { serviceId: crypto.randomUUID() }))).status).toBe(409);
    expect((await book(details(slot(2, 22).toISO({ suppressMilliseconds: true }) as string))).status).toBe(409);
    google.busy = [{ start, end: slot(2, 11).toISO()! }];
    expect((await book(details(start))).status).toBe(409);
    google.failFreeBusy = true;
    expect((await book(details(start))).status).toBe(502);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(google.events.size).toBe(0);
  });

  it("compensates for a Google conflict after writing the event without saving the contact", async () => {
    google.conflictAfterWrite = true;
    expect((await book(details(slot(2, 10).toISO()!))).status).toBe(409);
    expect(google.calls).toEqual(["insert", expect.stringMatching(/^delete /)]);
    expect(google.events.size).toBe(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("returns field errors for a bad phone, a missing name and a bad email", async () => {
    const start = slot(2, 10).toISO({ suppressMilliseconds: true }) as string;
    expect((await (await book(details(start, { phone: "12" }))).json()).fields.phone).toBeTruthy();
    expect((await (await book(details(start, { name: " " }))).json()).fields.name).toBeTruthy();
    expect((await (await book(details(start, { email: "nope" }))).json()).fields.email).toBeTruthy();
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("returns 404 for an unknown key", async () => {
    expect((await book(details(slot(2, 10).toISO() as string), "pk_nope")).status).toBe(404);
  });
});

describe("public booking limits", () => {
  it("limits concurrent attempts from one client while leaving another client's budget available", async () => {
    const responses = await Promise.all(Array.from({ length: publicBookingLimits.client + 2 }, (_, index) =>
      postBooking({}, PK, fromClient(index % 2 ? "2001:db8::1" : "2001:0db8:0:0:0:0:0:1"))));
    expect(responses.filter(r => r.status === 422)).toHaveLength(publicBookingLimits.client);
    const blocked = responses.filter(r => r.status === 429);
    expect(blocked).toHaveLength(2);
    expect(Number(blocked[0].headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(blocked[0].headers.get("retry-after"))).toBeLessThanOrEqual(publicBookingLimits.windowSeconds);
    expect((await postBooking(details(slot(2, 10).toISO()!), PK, fromClient("2001:db8::1"))).status).toBe(429);
    expect((await postBooking({}, PK, fromClient("192.0.2.1"))).status).toBe(422);
    expect(google.calls).toEqual([]);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("keeps the next open slot available when a client reaches the limit with valid bookings", async () => {
    const client = fromClient("192.0.2.1");
    for (let index = 0; index < publicBookingLimits.client; index++) {
      const start = slot(2, 9 + index).toISO()!;
      const response = await postBooking(details(start, { phone: `07700 900${120 + index}` }), PK, client);
      expect(response.status).toBe(201);
    }
    await drain();
    const booked = await db.select().from(appointments);
    const people = await db.select().from(contacts);
    expect(booked).toHaveLength(publicBookingLimits.client);
    expect(people).toHaveLength(publicBookingLimits.client);
    expect(new Set(booked.map(row => row.googleEventId))).toEqual(new Set(google.events.keys()));

    const stillOpen = slot(2, 9 + publicBookingLimits.client);
    const start = stillOpen.toISO()!;
    const response = await postBooking(details(start, { name: "Grace", phone: "07700 900456" }), PK, client);
    expect(response.status).toBe(429);
    expect(await db.select().from(appointments)).toEqual(booked);
    expect(await db.select().from(contacts)).toEqual(people);
    expect(google.calls.filter(call => call === "insert")).toHaveLength(publicBookingLimits.client);
    expect(new Set(google.events.keys())).toEqual(new Set(booked.map(row => row.googleEventId)));
    const availability = await (await getSlots(PK, `&from=${stillOpen.toISODate()}&to=${stillOpen.toISODate()}`)).json();
    expect(availability.slots.map((offered: { start: string }) => Date.parse(offered.start))).toContain(stillOpen.toMillis());
  });

  it("limits a workspace across distinct clients and leaves another workspace available", async () => {
    const responses = await Promise.all(Array.from({ length: publicBookingLimits.workspace + 3 }, (_, index) =>
      postBooking({}, PK, fromClient(`192.0.2.${index + 1}`))));
    expect(responses.filter(r => r.status === 422)).toHaveLength(publicBookingLimits.workspace);
    expect(responses.filter(r => r.status === 429)).toHaveLength(3);
    expect((await postBooking(details(slot(2, 10).toISO()!), PK, fromClient("192.0.2.200"))).status).toBe(429);
    expect(await db.select().from(contacts)).toEqual([]);
    expect(await db.select().from(appointments)).toEqual([]);
    expect(google.events.size).toBe(0);
    expect(google.calls).toEqual([]);
    const [other] = await db.insert(workspaces).values({ slug: "other", name: "Other", webhookSecretEncrypted: "unused" }).returning();
    await db.insert(embeds).values({ workspaceId: other.id, publicKey: "pk_other" });
    expect((await postBooking({}, "pk_other", fromClient("192.0.2.1"))).status).toBe(422);
  });

  it("ignores forwarded headers without a trusted ingress and shares the fallback when the trusted IP is missing or malformed", async () => {
    ingress.header = undefined;
    expect((await postBooking({}, PK, fromClient("192.0.2.1"))).status).toBe(422);
    ingress.header = "x-public-booking-client-ip";
    for (let index = 1; index < publicBookingLimits.client; index++) {
      const forwarded = { "x-forwarded-for": `192.0.2.${index}` };
      const invalid = index % 2 ? {} : fromClient(`192.0.2.${index}, 198.51.100.1`);
      expect((await postBooking({}, PK, { ...forwarded, ...invalid })).status).toBe(422);
    }
    expect((await postBooking({}, PK, { "x-forwarded-for": "192.0.2.200" })).status).toBe(429);
    expect((await postBooking({}, PK, fromClient("192.0.2.1"))).status).toBe(422);
  });
});

describe("public request-only mode", () => {
  const setRequestOnly = (enabled: boolean) => db.update(calendars).set({ publicBookingRequestOnly: enabled }).where(eq(calendars.workspaceId, workspaceId));

  it("queues separate leads for the same preferred time and leaves room for a real booking", async () => {
    await setRequestOnly(true);
    const attempted: string[] = [];
    await saveIntegration("telegram", null, { botToken: "notification-test" }, {});
    await db.insert(notificationChannels).values({ workspaceId, type: "telegram", target: "12345", events: ["booking_new", "form_submitted"] });
    googleServer.use(http.post("https://api.telegram.org/botnotification-test/sendMessage", async ({ request }) => {
      attempted.push((await request.json() as { text: string }).text);
      return HttpResponse.json({ ok: true });
    }));
    const start = slot(2, 10);
    const iso = start.toISO({ suppressMilliseconds: true })!;
    const [first, second] = await Promise.all([
      postBooking(details(iso, { address: "12 Main Street", zip: "01234", notes: "Please call in the morning." })),
      postBooking(details(iso, { name: "Grace", phone: "07700 900456" })),
    ]);
    for (const response of [first, second]) {
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "requested", message: expect.stringContaining("confirm a time") });
    }
    const leads = await db.select().from(conversations);
    expect(leads).toHaveLength(2);
    expect(leads).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "form", outcome: "lead", contactId: expect.any(String),
        summary: "Please call in the morning.", structured: { service: "Cut", preferred_time: expect.stringContaining("10:00") } }),
    ]));
    expect(await db.select().from(contacts)).toHaveLength(2);
    const lead = leads.find(row => row.summary)!;
    expect(await db.select().from(jobs).where(eq(jobs.conversationId, lead.id))).toMatchObject([
      { contactId: lead.contactId, appointmentId: null, address: "12 Main Street", zip: "01234" },
    ]);
    expect(await db.select().from(notificationLog)).toMatchObject([
      { event: "form_submitted", status: "pending" }, { event: "form_submitted", status: "pending" },
    ]);
    expect(attempted).toHaveLength(0);
    await drain();
    expect(attempted).toHaveLength(2);
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(google.events.size).toBe(0);
    expect(google.calls).toEqual([]);
    const result = await (await getSlots(PK, `&from=${start.toISODate()}&to=${start.toISODate()}`)).json();
    expect(result.slots.map((s: { start: string }) => s.start)).toContain(iso);
    await setRequestOnly(false);
    expect((await book(details(iso))).status).toBe(201);
    expect(await db.select().from(appointments)).toHaveLength(1);
    expect(google.events.size).toBe(1);
  });

  it("rejects a bad service or unavailable preferred time without creating leads", async () => {
    await setRequestOnly(true);
    const start = slot(2, 10).toISO()!;
    google.busy = [{ start, end: slot(2, 11).toISO()! }];
    expect((await book(details(start, { requireRequestOnly: true }))).status).toBe(409);
    expect((await book(details(start, { serviceId: crypto.randomUUID() }))).status).toBe(409);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(0);
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(google.calls).toEqual([]);
  });

  it("rejects a stale request-only form after switching back to instant booking", async () => {
    const response = await book(details(slot(2, 10).toISO()!, { requireRequestOnly: true }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Refresh this page") });
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(google.calls).toEqual([]);
  });

  it("rejects a request-only submission if instant booking is enabled during validation", async () => {
    await setRequestOnly(true);
    googleServer.use(http.post("https://www.googleapis.com/calendar/v3/freeBusy", async () => {
      await setRequestOnly(false);
      return HttpResponse.json({ calendars: { cal1: { busy: [] } } });
    }));
    const response = await book(details(slot(2, 10).toISO()!, { requireRequestOnly: true }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Refresh this page") });
    expect(await db.select().from(contacts)).toEqual([]);
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(jobs)).toEqual([]);
    expect(await db.select().from(notificationLog)).toEqual([]);
    expect(await db.select().from(appointments)).toEqual([]);
    expect(google.events.size).toBe(0);
    expect(google.calls).toEqual([]);
  });

  it("does not reserve a slot if request-only is enabled during an instant submission", async () => {
    googleServer.use(http.post("https://www.googleapis.com/calendar/v3/freeBusy", async () => {
      await setRequestOnly(true);
      return HttpResponse.json({ calendars: { cal1: { busy: [] } } });
    }));
    const response = await book(details(slot(2, 10).toISO()!));
    expect(response.status).toBe(422);
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(google.calls).toEqual([]);
  });
});
