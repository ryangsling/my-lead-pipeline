import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { appointments, contacts, embeds, jobs, workspaces } from "@/lib/db/schema";
import { googleServer, seedWorld, slot, startGoogle } from "./helpers/world";

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => void pending.push(fn()),
}));

const slotsRoute = await import("@/app/api/public/[pk]/slots/route");
const bookRoute = await import("@/app/api/public/[pk]/book/route");

const PK = "pk_test_bloom";
let workspaceId: string;
let serviceId: string;

const ctx = (pk: string) => ({ params: Promise.resolve({ pk }) }) as never;
const getSlots = (pk = PK, query = "") =>
  slotsRoute.GET(new Request(`http://localhost/api/public/${pk}/slots?serviceId=${serviceId}${query}`), ctx(pk));
const book = async (body: Record<string, unknown>, pk = PK) => {
  const res = await bookRoute.POST(new Request(`http://localhost/api/public/${pk}/book`, { method: "POST", body: JSON.stringify(body) }), ctx(pk));
  await Promise.all(pending.splice(0));
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
  startGoogle();
});
afterAll(() => googleServer.close());
beforeEach(async () => {
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

  it("answers 409 when the slot is taken", async () => {
    const start = slot(2, 10).toISO({ suppressMilliseconds: true }) as string;
    await book(details(start));
    const second = await book(details(start, { name: "Grace", phone: "07700 900456" }));
    expect(second.status).toBe(409);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("refuses a time outside working hours", async () => {
    expect((await book(details(slot(2, 22).toISO({ suppressMilliseconds: true }) as string))).status).toBe(409);
  });

  it("returns field errors for a bad phone, a missing name and a bad email", async () => {
    const start = slot(2, 10).toISO({ suppressMilliseconds: true }) as string;
    expect((await (await book(details(start, { phone: "12" }))).json()).fields.phone).toBeTruthy();
    expect((await (await book(details(start, { name: " " }))).json()).fields.name).toBeTruthy();
    expect((await (await book(details(start, { email: "nope" }))).json()).fields.email).toBeTruthy();
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("returns 404 for an unknown key", async () => {
    expect((await book(details(slot(2, 10).toISO() as string), "pk_nope")).status).toBe(404);
  });
});
