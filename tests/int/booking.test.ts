import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { DateTime, Settings } from "luxon";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, calendars, contacts, services, workspaces } from "@/lib/db/schema";
import { bookAppointment } from "@/lib/booking/book";
import { getOpenSlots } from "@/lib/booking/availability";
import { updateAppointmentStatus } from "@/lib/booking/status";
import * as calendarApi from "@/lib/google/calendar";
import * as reconciler from "@/lib/booking/reconcile";
import { GET as sweep } from "@/app/api/cron/sweep/route";
import { testEnv } from "../test-env";
import { google, googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

let workspaceId: string;
let serviceId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
  ({ workspaceId, serviceId } = await seedWorld());
});

const book = (start: DateTime) =>
  bookAppointment({ workspaceId, serviceId, start: start.toISO() as string, source: "form" });

describe("availability", () => {
  it("returns only free slots inside working hours in workspace time", async () => {
    const target = slot(2, 10);
    google.busy = [{ start: target.toUTC().toISO() as string, end: target.plus({ hours: 1 }).toUTC().toISO() as string }];
    const slots = await getOpenSlots({
      workspaceId,
      serviceId,
      from: target.toISODate() as string,
      to: target.toISODate() as string,
    });
    const times = slots.map((s) => DateTime.fromISO(s.start, { setZone: true }).toFormat("HH:mm"));
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("09:30");
    expect(times).toContain("09:00");
    expect(times).toContain("11:00");
    expect(times.at(-1)).toBe("16:00");
  });

  const overnight = async () => {
    const target = slot(2, 23).set({ minute: 30 });
    const weekday = target.setLocale("en").toFormat("ccc").toLowerCase();
    await db.update(calendars).set({ workingHours: { [weekday]: { open: "20:00", close: "06:00" } } })
      .where(eq(calendars.workspaceId, workspaceId));
    await db.update(services).set({ bufferMin: 30 }).where(eq(services.id, serviceId));
    return target;
  };
  const startsOn = async (target: DateTime, fresh = false) => {
    const date = target.toISODate()!;
    const slots = await getOpenSlots({ workspaceId, serviceId, from: date, to: date, fresh });
    return slots.map(s => Date.parse(s.start));
  };

  it("queries Google past midnight when a before-midnight slot has an after-midnight buffer", async () => {
    const target = await overnight();
    expect(await startsOn(target)).toContain(target.toMillis());
    google.busy = [{ start: target.plus({ minutes: 75 }).toISO()!, end: target.plus({ minutes: 80 }).toISO()! }];
    const offered = await startsOn(target, true);
    expect(offered).toContain(target.minus({ minutes: 30 }).toMillis());
    expect(offered).not.toContain(target.toMillis());
    expect(await book(target)).toMatchObject({ ok: false, reason: "invalid_slot" });
    expect(google.events.size).toBe(0);
  });

  it("blocks a before-midnight start when the hub holds a slot after midnight", async () => {
    const target = await overnight();
    const carriedIn = target.plus({ minutes: 60 });
    expect(await startsOn(carriedIn)).toContain(carriedIn.toMillis());
    await bookedAt(carriedIn);
    expect(await startsOn(target)).not.toContain(target.toMillis());
  });

  it("books an overnight visit across spring-forward and rejects a buffer that would cross closing", async () => {
    const timezone = "America/New_York";
    await db.update(workspaces).set({ timezone }).where(eq(workspaces.id, workspaceId));
    await db.update(calendars).set({ workingHours: { sat: { open: "20:00", close: "04:00" } } })
      .where(eq(calendars.workspaceId, workspaceId));
    await db.update(services).set({ durationMin: 30, bufferMin: 30 }).where(eq(services.id, serviceId));
    const clock = vi.spyOn(Settings, "now").mockReturnValue(Date.parse("2027-03-14T05:00:00Z"));
    try {
      const date = "2027-03-14";
      const slots = await getOpenSlots({ workspaceId, serviceId, from: date, to: date });
      expect(slots.map(slot => slot.start)).toEqual([
        "2027-03-14T00:00:00-05:00", "2027-03-14T00:30:00-05:00", "2027-03-14T01:00:00-05:00",
        "2027-03-14T01:30:00-05:00", "2027-03-14T03:00:00-04:00",
      ]);
      const tooLate = DateTime.fromISO(`${date}T03:30:00`, { zone: timezone });
      expect(await book(tooLate)).toMatchObject({ ok: false, reason: "invalid_slot" });
      expect(await db.select().from(appointments)).toEqual([]);
      expect(google.events.size).toBe(0);

      const start = DateTime.fromISO(`${date}T01:30:00`, { zone: timezone });
      const confirmed = await bookedAt(start);
      const saved = await expectBooking(confirmed.id, start);
      expect(saved.endAt.toISOString()).toBe("2027-03-14T07:00:00.000Z");
      expect(saved.blockedUntil.toISOString()).toBe("2027-03-14T07:30:00.000Z");
      expect(google.events.size).toBe(1);
    } finally { clock.mockRestore(); }
  });
});

describe("bookAppointment", () => {
  it("20 parallel calls for one slot give 1 success and 19 slot_taken", async () => {
    const target = slot(2, 10);
    const results = await Promise.all(Array.from({ length: 20 }, () => book(target)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "slot_taken")).toHaveLength(19);
    expect(await db.select().from(appointments)).toHaveLength(1);
    expect(google.calls.filter((c) => c === "insert")).toHaveLength(1);
  });

  it("puts the contact name, phone and notes in the Google event", async () => {
    const [contact] = await db
      .insert(contacts)
      .values({ workspaceId, name: "Ada Lovelace", phoneE164: "+447700900123" })
      .returning();
    const result = await bookAppointment({
      workspaceId,
      serviceId,
      contactId: contact.id,
      start: slot(2, 10).toISO() as string,
      source: "form",
      notes: "First visit",
    });
    expect(result.ok).toBe(true);
    expect(google.lastEvent?.summary).toBe("Cut - Ada Lovelace");
    expect(google.lastEvent?.description).toBe("Name: Ada Lovelace\nPhone: +447700900123\nNotes: First visit");
  });

  it("refuses a time outside working hours", async () => {
    const result = await book(slot(2, 20));
    expect(result).toMatchObject({ ok: false, reason: "invalid_slot" });
  });

  it("holds the interval after a Google 503 and recovers on the authenticated sweep", async () => {
    google.failInsert = true;
    const result = await book(slot(2, 10));
    expect(result).toMatchObject({ ok: false, reason: "pending" });
    const [a] = await db.select().from(appointments);
    expect(a.status).toBe("pending");
    expect(google.events.size).toBe(0);
    expect(await book(slot(2, 10))).toMatchObject({ reason: "slot_taken" });
    google.failInsert = false;
    await recover();
    await expectBooking(a.id, slot(2, 10));
  });
});

describe("updateAppointmentStatus", () => {
  it("cancelling frees the slot and deletes the Google event", async () => {
    const target = slot(2, 10);
    const first = await book(target);
    if (!first.ok) throw new Error(first.message);
    const cancelled = await updateAppointmentStatus(workspaceId, first.appointment.id, "cancelled");
    expect(cancelled.ok).toBe(true);
    expect(google.calls).toContain(`delete ${first.appointment.googleEventId}`);
    expect((await book(target)).ok).toBe(true);
  });

  it("a reschedule moves the event and the row", async () => {
    const first = await book(slot(2, 10));
    if (!first.ok) throw new Error(first.message);
    const moved = slot(2, 14);
    const result = await updateAppointmentStatus(workspaceId, first.appointment.id, "rescheduled", moved.toISO() as string);
    expect(result.ok).toBe(true);
    expect(google.calls).toContain(`patch ${first.appointment.googleEventId}`);
    const [row] = await db.select().from(appointments).where(eq(appointments.id, first.appointment.id));
    expect(row.startAt.getTime()).toBe(moved.toMillis());
    expect(row.status).toBe("rescheduled");
  });

  it("refuses a reschedule onto a taken slot", async () => {
    const a = await book(slot(2, 10));
    await book(slot(2, 14));
    if (!a.ok) throw new Error(a.message);
    const result = await updateAppointmentStatus(workspaceId, a.appointment.id, "rescheduled", slot(2, 14).toISO() as string);
    expect(result.ok).toBe(false);
  });

  it("ignores an appointment id from another workspace", async () => {
    const first = await book(slot(2, 10));
    if (!first.ok) throw new Error(first.message);
    const [other] = await db
      .insert(workspaces)
      .values({ slug: "other", name: "Other", webhookSecretEncrypted: encrypt("s") })
      .returning();
    const result = await updateAppointmentStatus(other.id, first.appointment.id, "cancelled");
    expect(result).toEqual({ ok: false, message: "Appointment not found" });
  });
});

it("requires current coverage and a location before committing an estimate visit", async () => {
  await db.update(workspaces).set({ serviceZips: ["01234"], serviceCities: ["Example City"] }).where(eq(workspaces.id, workspaceId));
  await db.update(services).set({ visitKind: "estimate", bufferMin: 30 }).where(eq(services.id, serviceId));
  const input = { workspaceId, serviceId, source: "phone" as const, start: slot(2, 10).toISO()! };
  expect(await bookAppointment(input)).toMatchObject({ reason: "outside_area" });
  expect(await bookAppointment({ ...input, site: { zip: "01234" } })).toMatchObject({ reason: "missing_location" });
  const site = { zip: "01234", address: "123 Example Street" };
  await db.update(workspaces).set({ serviceZips: ["99999"] }).where(eq(workspaces.id, workspaceId));
  expect(await bookAppointment({ ...input, site })).toMatchObject({ reason: "outside_area" });
  expect(await bookAppointment({ ...input, site: { ...site, city: "example city" } })).toMatchObject({ ok: true });
});

async function recover() {
  await db.update(appointments).set({ reconcileAt: new Date(0) }).where(eq(appointments.status, "pending"));
  const response = await sweep(new Request("http://localhost/api/cron/sweep", {
    headers: { authorization: `Bearer ${testEnv.CRON_SECRET}` },
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).appointments.pending).toBe(0);
}

async function expectBooking(id: string, start: DateTime, status = "booked") {
  const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
  expect(row).toMatchObject({ status, calendarOperation: null, targetStart: null, startAt: start.toJSDate() });
  const event = google.events.get(row.googleEventId!);
  expect(Date.parse(event?.start.dateTime ?? "")).toBe(start.toMillis());
  expect(Date.parse(event?.end.dateTime ?? "")).toBe(row.endAt.getTime());
  return row;
}

async function bookedAt(start: DateTime) {
  const result = await book(start);
  if (!result.ok) throw new Error(result.message);
  return result.appointment;
}

describe("durable calendar operations", () => {
  it("rejects an unauthenticated sweep", async () => {
    expect((await sweep(new Request("http://localhost/api/cron/sweep"))).status).toBe(401);
  });

  it("resumes after process exit between the reservation commit and the Google call", async () => {
    const interrupted = vi.spyOn(reconciler, "reconcileAppointment").mockRejectedValueOnce(new Error("process exit"));
    try {
      await expect(book(slot(2, 10))).rejects.toThrow("process exit");
    } finally {
      interrupted.mockRestore();
    }
    const [row] = await db.select().from(appointments);
    expect(row.status).toBe("pending");
    expect(google.events.size).toBe(0);
    await recover();
    await expectBooking(row.id, slot(2, 10));
    expect(google.events.size).toBe(1);
  });

  it("adopts the same event after Google creates it and the response is lost", async () => {
    google.loseInsertResponse = true;
    expect(await book(slot(2, 10))).toMatchObject({ reason: "pending" });
    const [row] = await db.select().from(appointments);
    expect(row.status).toBe("pending");
    expect(google.events.has(row.id.replaceAll("-", ""))).toBe(true);
    const count = google.calls.filter(c => c === "insert").length;
    await recover();
    await expectBooking(row.id, slot(2, 10));
    await recover();
    expect(google.events.size).toBe(1);
    expect(google.calls.filter(c => c === "insert")).toHaveLength(count);
  });

  it("reconciles an accepted Google insert after the voice deadline expires", async () => {
    const start = slot(2, 10);
    google.insertResponseDelayMs = 2000;
    expect(await bookAppointment({ workspaceId, serviceId, start: start.toJSDate(), source: "phone" }))
      .toMatchObject({ reason: "pending", message: expect.stringContaining("awaiting confirmation") });

    const [reservation] = await db.select().from(appointments);
    expect(reservation).toMatchObject({ status: "pending", startAt: start.toJSDate() });
    expect(google.events.has(reservation.googleEventId!)).toBe(true);
    expect(await book(start)).toMatchObject({ reason: "slot_taken" });

    await recover();
    const booking = await expectBooking(reservation.id, start);
    expect(booking.googleEventId).toBe(reservation.googleEventId);
    expect(google.events.size).toBe(1);
    expect(google.calls.filter(c => c === "insert")).toHaveLength(1);
  });

  it("resumes after the worker exits immediately after Google acknowledges creation", async () => {
    const create = calendarApi.createEvent;
    const interrupted = vi.spyOn(calendarApi, "createEvent").mockImplementationOnce(async (...args) => {
      await create(...args);
      throw new Error("worker stopped after provider acknowledgement");
    });
    try {
      expect(await book(slot(2, 10))).toMatchObject({ reason: "pending" });
    } finally {
      interrupted.mockRestore();
    }
    const [row] = await db.select().from(appointments);
    expect(row.status).toBe("pending");
    expect(google.events.has(row.googleEventId!)).toBe(true);
    await recover();
    await expectBooking(row.id, slot(2, 10));
    expect(google.calls.filter(c => c === "insert")).toHaveLength(1);
  });

  it("recovers a failed final DB write with the existing Google event", async () => {
    await db.execute(sql`CREATE FUNCTION test_fail_booking_commit() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'simulated final write failure'; END; $$`);
    await db.execute(sql`CREATE TRIGGER test_booking_failure BEFORE UPDATE ON appointments
      FOR EACH ROW WHEN (NEW.status = 'booked') EXECUTE FUNCTION test_fail_booking_commit()`);
    try {
      expect(await book(slot(2, 10))).toMatchObject({ reason: "pending" });
      const [row] = await db.select().from(appointments);
      expect(row.status).toBe("pending");
      expect(google.events.has(row.googleEventId!)).toBe(true);
    } finally {
      await db.execute(sql`DROP TRIGGER test_booking_failure ON appointments`);
      await db.execute(sql`DROP FUNCTION test_fail_booking_commit()`);
    }
    const [row] = await db.select().from(appointments);
    await recover();
    await expectBooking(row.id, slot(2, 10));
    expect(google.calls.filter(c => c === "insert")).toHaveLength(1);
  });

  it("lets only one move to overlapping target intervals win and keeps Google in step", async () => {
    const attempts = [
      { appointment: await bookedAt(slot(2, 9)), target: slot(2, 14) },
      { appointment: await bookedAt(slot(2, 11)), target: slot(2, 14).plus({ minutes: 30 }) },
    ];
    const checkBusy = calendarApi.otherBusyEvents;
    const initialChecks: boolean[] = [];
    const waitForBothChecks: typeof checkBusy = async (...args) => {
      const busy = await checkBusy(...args);
      initialChecks.push(busy);
      await vi.waitFor(() => expect(initialChecks).toHaveLength(2));
      return busy;
    };
    const preflight = vi.spyOn(calendarApi, "otherBusyEvents")
      .mockImplementationOnce(waitForBothChecks)
      .mockImplementationOnce(waitForBothChecks);
    const moves = await Promise.all(attempts.map(({ appointment, target }) =>
      updateAppointmentStatus(workspaceId, appointment.id, "rescheduled", target.toJSDate())))
      .finally(() => preflight.mockRestore());
    expect(initialChecks).toEqual([false, false]);
    expect(moves.filter(r => r.ok)).toHaveLength(1);
    const winner = attempts[moves[0].ok ? 0 : 1];
    const { appointment: loser } = attempts[moves[0].ok ? 1 : 0];
    await expectBooking(winner.appointment.id, winner.target, "rescheduled");
    await expectBooking(loser.id, DateTime.fromJSDate(loser.startAt));
    expect(google.events.size).toBe(2);
    expect(google.calls.filter(c => c.startsWith("patch"))).toHaveLength(1);
  });

  it("holds the old and new intervals through a lost move response, leaving the gap open", async () => {
    const a = await bookedAt(slot(2, 9));
    google.losePatchResponse = true;
    const target = slot(2, 14);
    expect((await updateAppointmentStatus(workspaceId, a.id, "rescheduled", target.toJSDate())).ok).toBe(false);
    const [row] = await db.select().from(appointments);
    expect(row).toMatchObject({ startAt: a.startAt, targetStart: target.toJSDate(), status: "pending" });
    expect(Date.parse(google.events.get(a.googleEventId!)!.start.dateTime)).toBe(target.toMillis());
    expect(await book(slot(2, 9))).toMatchObject({ reason: "slot_taken" });
    expect(await book(target)).toMatchObject({ reason: "slot_taken" });
    const offered = await getOpenSlots({ workspaceId, serviceId, from: target.toISODate()!, to: target.toISODate()! });
    expect(offered.map(s => Date.parse(s.start))).not.toContain(target.toMillis());
    expect(offered.map(s => Date.parse(s.start))).not.toContain(a.startAt.getTime());
    expect((await book(slot(2, 11))).ok).toBe(true);
    await recover();
    await expectBooking(a.id, target, "rescheduled");
    expect((await book(slot(2, 9))).ok).toBe(true);
  });

  it("moves to an interval partially overlapping the appointment's own original hold", async () => {
    const a = await bookedAt(slot(2, 9));
    const target = slot(2, 9).plus({ minutes: 30 });
    expect((await updateAppointmentStatus(workspaceId, a.id, "rescheduled", target.toJSDate())).ok).toBe(true);
    await expectBooking(a.id, target, "rescheduled");
    expect(google.events.size).toBe(1);
  });

  it.each(["cancelled", "no_show"] as const)("recovers an ambiguous delete then reactivates %s with a fresh Google event ID", async status => {
    const when = slot(2, 10);
    const a = await bookedAt(when);
    google.loseDeleteResponse = true;
    expect((await updateAppointmentStatus(workspaceId, a.id, status)).ok).toBe(false);
    expect(google.events.size).toBe(0);
    expect(await book(when)).toMatchObject({ reason: "slot_taken" });
    await recover();
    const [cancelled] = await db.select().from(appointments);
    expect(cancelled).toMatchObject({ status, googleEventId: null });
    expect((await updateAppointmentStatus(workspaceId, a.id, "confirmed")).ok).toBe(true);
    const restored = await expectBooking(a.id, when, "confirmed");
    expect(restored.googleEventId).not.toBe(a.googleEventId);
    expect(google.events.size).toBe(1);
  });

  it("preserves cancellation when another appointment holds the interval", async () => {
    const when = slot(2, 10);
    const a = await bookedAt(when);
    await updateAppointmentStatus(workspaceId, a.id, "cancelled");
    const b = await bookedAt(when);
    expect((await updateAppointmentStatus(workspaceId, a.id, "confirmed")).ok).toBe(false);
    const [row] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(row).toMatchObject({ status: "cancelled", googleEventId: null });
    await expectBooking(b.id, when);
    expect(google.events.size).toBe(1);
  });

  it("removes a new event when a calendar edit races the fresh availability check", async () => {
    google.conflictAfterWrite = true;
    expect(await book(slot(2, 10))).toMatchObject({ reason: "slot_taken" });
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect(google.events.size).toBe(0);
    expect(google.busy).toHaveLength(1);
  });

  it("restores the original event and interval when an independent edit races a move", async () => {
    const a = await bookedAt(slot(2, 10));
    google.conflictAfterWrite = true;
    expect((await updateAppointmentStatus(workspaceId, a.id, "rescheduled", slot(2, 14).toJSDate())).ok).toBe(false);
    await expectBooking(a.id, slot(2, 10));
    expect(google.events.size).toBe(1);
    expect(google.busy).toHaveLength(1);
  });
});
