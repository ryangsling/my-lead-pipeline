import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));

const { GET: listGet, POST: create } = await import("@/app/api/workspaces/route");
const { GET: oneGet, PATCH: edit, DELETE: archive } = await import("@/app/api/workspaces/[id]/route");

const ADMIN = { email: "admin@example.com" };
const slugs = ["t-one", "t-two", "t-three"];
const body = (slug: string, extra = {}) => ({
  name: `Test ${slug}`,
  slug,
  niche: "salon",
  country: "gb",
  timezone: "Europe/London",
  phoneDisplay: "",
  vapiMode: "own",
  businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
  ...extra,
});
const json = (method: string, data: unknown) =>
  new Request("http://localhost/api", { method, body: JSON.stringify(data) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  session = ADMIN;
  await db.delete(workspaces).where(inArray(workspaces.slug, slugs));
});
afterAll(() => db.delete(workspaces).where(inArray(workspaces.slug, slugs)));

describe("admin guard", () => {
  const calls = {
    "GET /api/workspaces": () => listGet(),
    "POST /api/workspaces": () => create(json("POST", body("t-one"))),
    "GET /api/workspaces/:id": () => oneGet(new Request("http://localhost/x"), ctx("x")),
    "PATCH /api/workspaces/:id": () => edit(json("PATCH", {}), ctx("x")),
    "DELETE /api/workspaces/:id": () => archive(new Request("http://localhost/x"), ctx("x")),
  };
  for (const [name, call] of Object.entries(calls)) {
    it(`${name} returns 401 with no session`, async () => {
      session = null;
      expect((await call()).status).toBe(401);
    });
    it(`${name} returns 403 for an email outside ADMIN_EMAILS`, async () => {
      session = { email: "stranger@example.com" };
      expect((await call()).status).toBe(403);
    });
  }
});

describe("workspaces", () => {
  it("creates, lists, edits and archives; never returns the webhook secret", async () => {
    const res = await create(json("POST", body("t-one")));
    expect(res.status).toBe(201);
    const { workspace } = await res.json();
    expect(workspace.country).toBe("GB");
    expect(workspace.retentionDays).toBe(90);
    expect(workspace).not.toHaveProperty("webhookSecretEncrypted");

    const [stored] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(stored.webhookSecretEncrypted.split(".")).toHaveLength(3);

    const list = await (await listGet()).json();
    expect(list.workspaces.map((w: { slug: string }) => w.slug)).toContain("t-one");

    const patched = await edit(json("PATCH", { name: "Renamed", retentionDays: 7 }), ctx(workspace.id));
    expect((await patched.json()).workspace).toMatchObject({ name: "Renamed", retentionDays: 7 });
    expect((await edit(json("PATCH", { retentionDays: 0 }), ctx(workspace.id))).status).toBe(422);

    expect((await archive(new Request("http://localhost/x"), ctx(workspace.id))).status).toBe(200);
    const after = await (await listGet()).json();
    expect(after.workspaces.map((w: { slug: string }) => w.slug)).not.toContain("t-one");
  });

  it("returns a clear error for a duplicate slug on create and on edit", async () => {
    await create(json("POST", body("t-one")));
    const dup = await create(json("POST", body("t-one")));
    expect(dup.status).toBe(422);
    expect((await dup.json()).fields.slug).toMatch(/already used/);

    const { workspace } = await (await create(json("POST", body("t-two")))).json();
    const clash = await edit(json("PATCH", { slug: "t-one" }), ctx(workspace.id));
    expect(clash.status).toBe(422);
    expect((await clash.json()).fields.slug).toMatch(/already used/);
  });

  it("rejects a bad slug and an unknown timezone with field errors", async () => {
    const res = await create(json("POST", body("Bad Slug", { timezone: "Mars/Base" })));
    expect(res.status).toBe(422);
    const { fields } = await res.json();
    expect(fields.slug).toBeTruthy();
    expect(fields.timezone).toBeTruthy();
  });
});
