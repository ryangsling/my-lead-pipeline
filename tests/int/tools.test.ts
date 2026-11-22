import { delay, http, HttpResponse } from "msw";
import { DateTime, Settings } from "luxon";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, calendars, contacts, conversations, jobs, offeredSlots, services, workspaces } from "@/lib/db/schema";
import { runTool, type ToolContext } from "@/lib/tools/run";
import { google, googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

let workspaceId: string;
let ctx: ToolContext;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  ({ workspaceId } = await seedWorld());
  const [conversation] = await db
    .insert(conversations)
    .values({ workspaceId, channel: "phone", externalId: "call_1" })
    .returning();
  ctx = { workspaceId, conversationId: conversation.id, channel: "phone" };
});

const booking = async (start: string, extra: Record<string, unknown> = {}) => {
  const reply = await runTool("check_availability", { service: "Cut", date: start.slice(0, 10) }, ctx);
  const options = (reply.data as { options?: { slot_id: string; start: string }[] } | undefined)?.options ?? [];
  return {
    service: "Cut",
    slot_id: options.find((option) => Date.parse(option.start) === Date.parse(start))?.slot_id ?? crypto.randomUUID(),
    name: "Ada Lovelace",
    phone: "07700 900123",
    ...extra,
  };
};
const outcome = async () =>
  (await db.select().from(conversations).where(eq(conversations.id, ctx.conversationId as string)))[0];

describe("check_availability", () => {
  it("offers up to 3 spoken slots with ISO times and today's date", async () => {
    const { result, data } = await runTool("check_availability", { service: "Cut" }, ctx);
    expect(result).toMatch(/Cut has these times free: .+ or .+\./);
    expect(result).toMatch(/Today is \w+ \d{1,2} \w+ \d{4}\.$/);
    expect((data as { options: {start: string}[] }).options).toHaveLength(3);
  });

  it.each(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"])(
    "resolves tomorrow morning and clarifies past dates at 11:55 p.m. in %s", async (timezone) => {
      await db.update(workspaces).set({ timezone }).where(eq(workspaces.id, workspaceId));
      const clock = Settings.now;
      const lateEvening = DateTime.fromISO("2026-11-22T23:55:00", { zone: timezone }).toMillis();
      Settings.now = () => lateEvening;
      try {
        const next = await runTool("check_availability", { service: "Cut", date: "tomorrow", part_of_day: "morning" }, ctx);
        const { options } = next.data as { options: { start: string }[] };
        expect(options.map(option => DateTime.fromISO(option.start, { zone: timezone }).toFormat("yyyy-MM-dd HH:mm")))
          .toEqual(["2026-11-23 09:00", "2026-11-23 09:30", "2026-11-23 10:00"]);
        expect(next.result).toContain("Today is Sunday 22 November 2026.");
        const past = await runTool("check_availability", { service: "Cut", date: "2026-11-21", part_of_day: "morning" }, ctx);
        expect(past.result).toContain("That date is in the past. Which upcoming day works for you?");
        expect(past.data).toBeUndefined();
      } finally { Settings.now = clock; }
    },
  );

  it.each([
    { timezone: "America/New_York", daylight: "-04:00", standard: "-05:00" },
    { timezone: "America/Chicago", daylight: "-05:00", standard: "-06:00" },
    { timezone: "America/Denver", daylight: "-06:00", standard: "-07:00" },
    { timezone: "America/Phoenix", daylight: "-07:00", standard: "-07:00" },
    { timezone: "America/Los_Angeles", daylight: "-07:00", standard: "-08:00" },
  ])("speaks and books each available 1:30 occurrence in $timezone", async ({ timezone, daylight, standard }) => {
    await db.update(workspaces).set({ timezone }).where(eq(workspaces.id, workspaceId));
    await db.update(calendars).set({ workingHours: { sat: { open: "20:00", close: "06:00" } } })
      .where(eq(calendars.workspaceId, workspaceId));
    await db.update(services).set({ durationMin: 30 }).where(eq(services.workspaceId, workspaceId));
    const clock = Settings.now;
    Settings.now = () => Date.parse(`2027-11-07T01:20:00${daylight}`);
    try {
      const reply = await runTool("check_availability", { service: "Cut", date: "today", part_of_day: "morning" }, ctx);
      const { options } = reply.data as { options: { start: string; time: string; slot_id: string }[] };
      const repeated = options.filter(option => option.time.includes("1:30 AM"));
      const label = "Sunday 7 November at 1:30 AM";
      const occurrences = daylight === standard
        ? [{ offset: standard, time: label }]
        : [{ offset: daylight, time: `${label} (before the clocks change)` }, { offset: standard, time: `${label} (after the clocks change)` }];
      expect(repeated).toEqual(occurrences.map(({ offset, time }) => ({
        start: new Date(`2027-11-07T01:30:00${offset}`).toISOString(),
        time,
        slot_id: expect.any(String),
      })));
      expect(new Set(repeated.map(option => option.slot_id)).size).toBe(occurrences.length);
      const savedOffers = await db.select().from(offeredSlots).where(eq(offeredSlots.workspaceId, workspaceId));
      for (const option of repeated) {
        expect(savedOffers).toContainEqual(expect.objectContaining({
          id: option.slot_id, conversationId: ctx.conversationId, start: new Date(option.start),
        }));
        expect(reply.result).toContain(option.time);
        const confirmation = await runTool("book_appointment", {
          service: "Cut", slot_id: option.slot_id, name: "Ada Lovelace", phone: "+44 7700 900123",
        }, ctx);
        expect(confirmation.result).toContain(`on ${option.time}`);
        expect(confirmation.data).toMatchObject({ start: option.start });
      }
      expect((await db.select().from(appointments)).map(a => a.startAt.toISOString()).sort()).toEqual(repeated.map(option => option.start));
      expect([...google.events.values()].map(event => event.start.dateTime).sort()).toEqual(repeated.map(option => option.start));
    } finally { Settings.now = clock; }
  });

  it("rejects expired offers and never-offered times", async () => {
    const args = await booking(slot(2, 10).toISO()!);
    await db.update(offeredSlots).set({ expiresAt: new Date(0) }).where(eq(offeredSlots.workspaceId, workspaceId));
    expect((await runTool("book_appointment", args, ctx)).result).toContain("no longer available");
    const unoffered = { ...args, slot_id: crypto.randomUUID() };
    expect((await runTool("book_appointment", unoffered, ctx)).result).toContain("no longer available");
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("suggests the nearest alternatives when the day is full", async () => {
    const day = slot(2, 0);
    google.busy = [{ start: day.startOf("day").toUTC().toISO() as string, end: day.endOf("day").toUTC().toISO() as string }];
    const { result, data } = await runTool("check_availability", { service: "Cut", date: day.toISODate() }, ctx);
    expect(result).toContain("Nothing is free on");
    expect((data as { options: {start: string}[] }).options.length).toBeGreaterThan(0);
  });

  it("explains that tomorrow morning is full when offering an afternoon slot on the same day", async () => {
    await db.update(workspaces).set({ timezone: "America/New_York" }).where(eq(workspaces.id, workspaceId));
    const clock = Settings.now;
    Settings.now = () => Date.parse("2026-11-22T23:55:00-05:00");
    google.busy = [{ start: "2026-11-23T14:00:00Z", end: "2026-11-23T17:00:00Z" }];
    try {
      const reply = await runTool("check_availability", { service: "Cut", date: "tomorrow", part_of_day: "morning" }, ctx);
      expect(reply.result).toContain("No morning times are free on Monday 23 November.");
      expect(reply.result).toContain("Monday 23 November at 12:00 PM");
      const { options: [first] } = reply.data as { options: { slot_id: string; start: string }[] };
      expect(first.start).toBe("2026-11-23T17:00:00.000Z");
      expect(await db.select().from(appointments)).toEqual([]);
      expect(google.events.size).toBe(0);

      const result = await runTool("book_appointment", {
        service: "Cut", slot_id: first.slot_id, name: "Ada Lovelace", phone: "+44 7700 900123",
      }, ctx);
      expect(result.data).toMatchObject({ start: first.start });
      const [appointment] = await db.select().from(appointments).where(eq(appointments.workspaceId, workspaceId));
      expect(appointment.startAt.toISOString()).toBe(first.start);
      expect([...google.events.values()]).toMatchObject([{ id: appointment.googleEventId, start: { dateTime: first.start } }]);
    } finally { Settings.now = clock; }
  });

  it("filters by part of day", async () => {
    const { data } = await runTool("check_availability", { service: "Cut", date: slot(2, 0).toISODate(), part_of_day: "afternoon" }, ctx);
    for (const iso of (data as { options: {start: string}[] }).options) expect(Number(iso.start.slice(11, 13))).toBeGreaterThanOrEqual(12);
  });

  it("names the real services when the requested one is unknown", async () => {
    const { result } = await runTool("check_availability", { service: "Massage" }, ctx);
    expect(result).toContain("I do not have a service called Massage. We offer Cut.");
  });

  it.each([{}, { cal1: {} }, { cal1: { busy: [], errors: [{ reason: "notFound" }] } }, { cal1: { busy: [{}] } }])(
    "declines an unverified free/busy response", async (calendars) => {
      googleServer.use(http.post("https://www.googleapis.com/calendar/v3/freeBusy", () => HttpResponse.json({ calendars })));
      try {
        expect((await runTool("check_availability", { service: "Cut" }, ctx)).result).toContain("I cannot check the calendar");
      } finally {
        googleServer.resetHandlers();
      }
    },
  );

  it("falls back within the voice budget when Google stalls", async () => {
    googleServer.use(http.post("https://www.googleapis.com/calendar/v3/freeBusy", async () => {
      await delay(2000);
      return HttpResponse.json({ calendars: { cal1: { busy: [] } } });
    }));
    try {
      const start = performance.now();
      expect((await runTool("check_availability", { service: "Cut" }, ctx)).result).toContain("I cannot check the calendar");
      expect(performance.now() - start).toBeLessThan(1500);
    } finally {
      googleServer.resetHandlers();
    }
  });

  it("answers with a sentence when Google is down", async () => {
    google.failFreeBusy = true;
    const { result } = await runTool("check_availability", { service: "Cut" }, ctx);
    expect(result).toContain("I cannot check the calendar right now");
  });
});

describe("book_appointment", () => {
  it("books, normalizes the phone to E.164 and marks the conversation booked", async () => {
    const start = slot(2, 10).toISO() as string;
    const { result } = await runTool("book_appointment", await booking(start), ctx);
    expect(result).toMatch(/You are booked in for Cut on .+\. Your reference is [0-9A-F]{8}\./);
    const [contact] = await db.select().from(contacts);
    expect(contact).toMatchObject({ phoneE164: "+447700900123", name: "Ada Lovelace", source: "phone" });
    expect(await outcome()).toMatchObject({ outcome: "booked", contactId: contact.id });
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("a taken slot returns a sentence and fresh alternatives", async () => {
    const start = slot(2, 10).toISO() as string;
    const choice = await booking(start);
    await runTool("book_appointment", choice, ctx);
    const second = await runTool("book_appointment", { ...choice, name: "Grace", phone: "07700 900456" }, ctx);
    expect(second.result).toMatch(/That time (was just taken|is not available)\. I can offer/);
    expect((second.data as { options: {start: string}[] }).options.length).toBeGreaterThan(0);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("refuses a time outside hours, with alternatives", async () => {
    const { result, data } = await runTool("book_appointment", await booking(slot(2, 22).toISO() as string), ctx);
    expect(result).toContain("That time is no longer available.");
    expect((data as { options: {start: string}[] }).options.length).toBeGreaterThan(0);
  });

  it("refuses a time in the past, with alternatives", async () => {
    const { result } = await runTool("book_appointment", await booking(slot(-3, 10).toISO() as string), ctx);
    expect(result).toContain("That time is no longer available.");
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("asks for the number again when the phone is not valid, and books nothing", async () => {
    const { result } = await runTool("book_appointment", await booking(slot(2, 10).toISO() as string, { phone: "12" }), ctx);
    expect(result).toContain("That phone number does not look right");
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("tells the caller an ambiguous Google result is awaiting confirmation", async () => {
    google.failInsert = true;
    const { result } = await runTool("book_appointment", await booking(slot(2, 10).toISO() as string), ctx);
    expect(result).toContain("awaiting confirmation");
    expect((await db.select().from(appointments))[0].status).toBe("pending");
    expect(google.events.size).toBe(0);
  });

  it("ignores arguments that name another workspace", async () => {
    const [other] = await db
      .insert(workspaces)
      .values({ slug: "other", name: "Other", webhookSecretEncrypted: encrypt("s") })
      .returning();
    await runTool("book_appointment", await booking(slot(2, 10).toISO() as string, { workspaceId: other.id, workspace_id: other.id }), ctx);
    const rows = await db.select().from(appointments);
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBe(workspaceId);
  });
});

describe("capture_lead", () => {
  it("saves the contact and marks the conversation as a lead", async () => {
    const { result } = await runTool("capture_lead", { name: "Ada", phone: "+44 7700 900123", reason: "Bridal trial" }, ctx);
    expect(result.startsWith("Saved, the team will call you.")).toBe(true);
    const row = await outcome();
    expect(row.outcome).toBe("lead");
    expect(row.structured).toMatchObject({ reason: "Bridal trial" });
    expect((await db.select().from(contacts))[0].phoneE164).toBe("+447700900123");
  });

  it("reuses the contact for the same phone number", async () => {
    await runTool("capture_lead", { name: "Ada", phone: "07700 900123" }, ctx);
    await runTool("capture_lead", { name: "Ada L", phone: "+447700900123", email: "ADA@example.com" }, ctx);
    const rows = await db.select().from(contacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ada", email: "ada@example.com" });
  });
});

describe("runTool", () => {
  it("answers an unknown tool and missing arguments with sentences", async () => {
    expect((await runTool("delete_everything", {}, ctx)).result).toContain("I cannot do that.");
    const missing = await runTool("capture_lead", { name: "Ada" }, ctx);
    expect(missing.result).toContain("I am missing some details: phone.");
  });
});

it("asks for a site ZIP and declines out-of-area offers", async () => {
  await db.update(workspaces).set({ serviceZips: ["01234"] }).where(eq(workspaces.id, workspaceId));
  expect((await runTool("check_availability", { service: "Cut" }, ctx)).result).toContain("site ZIP code");
  expect((await runTool("check_availability", { service: "Cut", zip: "86401" }, ctx)).result).toContain("outside our service area");
  expect((await runTool("check_availability", { service: "Cut", zip: "01234" }, ctx)).result).toContain("has these times free");
});

it("links lead and booking intake to one job and retains its callback window", async () => {
  await runTool("capture_lead", {
    name: "Ada", phone: "07700 900123", zip: "01234", address: "123 Example Road",
    callback_window: "Tomorrow morning", problem: "No heat", lead_source: "referral",
  }, ctx);
  expect((await db.select().from(jobs))[0]).toMatchObject({
    workspaceId, conversationId: ctx.conversationId, zip: "01234", problem: "No heat",
    timezone: "Europe/London", callbackWindow: "Tomorrow morning", leadSource: "referral", appointmentId: null,
  });
  await runTool("book_appointment", await booking(slot(2, 10).toISO()!), ctx);
  const [appointment] = await db.select().from(appointments);
  expect(await db.select().from(jobs)).toMatchObject([{
    appointmentId: appointment.id, conversationId: ctx.conversationId, jobType: "Cut", callbackWindow: "Tomorrow morning",
  }]);
});

it("uses a cached offer, then refreshes busy time before booking with one OAuth client", async () => {
  let reads = 0;
  let refreshes = 0;
  googleServer.use(
    http.post("https://www.googleapis.com/calendar/v3/freeBusy", () => {
      reads++;
      return HttpResponse.json({ calendars: { cal1: { busy: [] } } });
    }),
    http.post("https://oauth2.googleapis.com/token", () => {
      refreshes++;
      return HttpResponse.json({ access_token: "fixture", expires_in: 3600, token_type: "Bearer" });
    }),
  );
  try {
    const start = slot(2, 10).toISO()!;
    const offered = await booking(start);
    await booking(start);
    expect(reads).toBe(1);
    refreshes = 0;
    expect((await runTool("book_appointment", offered, ctx)).result).toContain("You are booked in");
    expect(reads).toBe(2);
    expect(refreshes).toBe(1);
  } finally {
    googleServer.resetHandlers();
  }
});
