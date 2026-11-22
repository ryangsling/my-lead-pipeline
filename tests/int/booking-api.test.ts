import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { services, workspaces } from "@/lib/db/schema";

let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => void pending.push(fn()),
}));

const booking = await import("@/app/api/workspaces/[id]/booking/route");
const servicesRoute = await import("@/app/api/workspaces/[id]/services/route");
const appointmentsRoute = await import("@/app/api/appointments/route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const put = (route: { PUT: (...a: never[]) => Promise<Response> }, id: string, body: unknown) =>
  route.PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }) as never, ctx(id) as never);

const settings = {
  googleCalendarId: "cal1",
  workingHours: { mon: { open: "09:00", close: "17:00" }, tue: null },
  slotStepMin: 30,
  minNoticeHours: 2,
  maxDaysAhead: 30,
};

let a: string;
let b: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  session = { email: "admin@example.com" };
  await db.execute(sql`truncate workspaces cascade`);
  const rows = await db
    .insert(workspaces)
    .values([
      { slug: "a", name: "A", webhookSecretEncrypted: encrypt("s") },
      { slug: "b", name: "B", webhookSecretEncrypted: encrypt("s") },
    ])
    .returning();
  [a, b] = rows.map((r) => r.id);
});

describe("auth", () => {
  it("returns 401 with no session and 403 for a non-admin", async () => {
    session = null;
    expect((await put(booking, a, settings)).status).toBe(401);
    expect((await put(servicesRoute, a, { services: [] })).status).toBe(401);
    expect((await appointmentsRoute.GET(new Request(`http://localhost/api/appointments?workspaceId=${a}`))).status).toBe(401);
    session = { email: "stranger@example.com" };
    expect((await put(booking, a, settings)).status).toBe(403);
    expect((await appointmentsRoute.PATCH(new Request("http://localhost/x", { method: "PATCH", body: "{}" }))).status).toBe(403);
  });
});

describe("booking settings", () => {
  it("saves and drops closed days", async () => {
    const res = await put(booking, a, settings);
    expect(res.status).toBe(200);
    expect((await res.json()).settings.workingHours).toEqual({ mon: { open: "09:00", close: "17:00" } });
  });

  it("allows admins to change request-only mode without changing another workspace", async () => {
    expect((await (await put(booking, a, { ...settings, publicBookingRequestOnly: true })).json()).settings.publicBookingRequestOnly).toBe(true);
    expect((await (await put(booking, a, settings)).json()).settings.publicBookingRequestOnly).toBe(true);
    expect((await (await put(booking, b, settings)).json()).settings.publicBookingRequestOnly).toBe(false);
    expect((await (await put(booking, a, { ...settings, publicBookingRequestOnly: false })).json()).settings.publicBookingRequestOnly).toBe(false);
  });

  it("saves an overnight shift on its opening weekday", async () => {
    const workingHours = { mon: { open: "20:00", close: "06:00" } };
    const res = await put(booking, a, { ...settings, workingHours });
    expect(res.status).toBe(200);
    expect((await res.json()).settings.workingHours).toEqual(workingHours);
  });

  it("rejects identical opening and closing times", async () => {
    const res = await put(booking, a, { ...settings, workingHours: { mon: { open: "09:00", close: "09:00" } } });
    expect(res.status).toBe(422);
  });

  it("returns 404 for an unknown workspace", async () => {
    expect((await put(booking, crypto.randomUUID(), settings)).status).toBe(404);
  });
});

describe("services", () => {
  it("creates, updates and never deletes", async () => {
    const created = await (await put(servicesRoute, a, { services: [{ name: "Cut", durationMin: 45, bufferMin: 5, priceText: "GBP 30", active: true }] })).json();
    const id = created.services[0].id;
    const updated = await (await put(servicesRoute, a, { services: [{ id, name: "Cut", durationMin: 60, bufferMin: 5, priceText: "GBP 30", active: false }] })).json();
    expect(updated.services).toHaveLength(1);
    expect(updated.services[0]).toMatchObject({ durationMin: 60, active: false });
    const empty = await (await put(servicesRoute, a, { services: [] })).json();
    expect(empty.services).toHaveLength(1);
  });

  it("does not update a service id that belongs to another workspace", async () => {
    const created = await (await put(servicesRoute, a, { services: [{ name: "Cut", durationMin: 45, bufferMin: 0, priceText: "", active: true }] })).json();
    await put(servicesRoute, b, { services: [{ id: created.services[0].id, name: "Hijack", durationMin: 10, bufferMin: 0, priceText: "", active: true }] });
    const rows = await db.select().from(services);
    expect(rows.find((r) => r.workspaceId === a)?.name).toBe("Cut");
    expect(rows.filter((r) => r.workspaceId === b)).toHaveLength(1);
  });

  it("rejects a blank name", async () => {
    const res = await put(servicesRoute, a, { services: [{ name: " ", durationMin: 30, bufferMin: 0, priceText: "", active: true }] });
    expect(res.status).toBe(422);
  });
});

describe("appointments route", () => {
  it("requires a workspaceId and validates the patch body", async () => {
    expect((await appointmentsRoute.GET(new Request("http://localhost/api/appointments"))).status).toBe(400);
    const bad = await appointmentsRoute.PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ workspaceId: a, id: crypto.randomUUID(), status: "nope" }) }));
    expect(bad.status).toBe(422);
  });
});
