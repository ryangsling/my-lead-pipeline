import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { DateTime } from "luxon";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { appointments, contacts, workspaces } from "@/lib/db/schema";
import { bookAppointment } from "@/lib/booking/book";
import { getOpenSlots } from "@/lib/booking/availability";
import { updateAppointmentStatus } from "@/lib/booking/status";
import { google, googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

let workspaceId: string;
let serviceId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  startGoogle();
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

  it("a Google failure leaves no appointment row and returns calendar_error", async () => {
    google.failInsert = true;
    const result = await book(slot(2, 10));
    expect(result).toMatchObject({ ok: false, reason: "calendar_error" });
    expect(await db.select().from(appointments)).toHaveLength(0);
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
