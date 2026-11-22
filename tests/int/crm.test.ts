import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { getContact, getConversation, listContacts, listConversations } from "@/lib/crm/list";
import { appointments, contacts, conversations, messages, services, workspaces } from "@/lib/db/schema";

let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));

const contactsRoute = await import("@/app/api/contacts/route");
const conversationsRoute = await import("@/app/api/conversations/route");

let a: string;
let b: string;
let ada: string;
let bobInB: string;

const json = (body: unknown, method: string) => new Request("http://localhost/x", { method, body: JSON.stringify(body) });

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
  a = rows.find((r) => r.slug === "a")!.id;
  b = rows.find((r) => r.slug === "b")!.id;
  const made = await db
    .insert(contacts)
    .values([
      { workspaceId: a, name: "Ada Lovelace", phoneE164: "+447700900123", email: "ada@example.com", source: "phone" },
      { workspaceId: a, name: "Grace Hopper", phoneE164: "+447700900456", source: "form" },
      { workspaceId: b, name: "Bob", phoneE164: "+447700900789", source: "phone" },
    ])
    .returning();
  ada = made[0].id;
  bobInB = made[2].id;
});

describe("contacts", () => {
  it("searches name, phone and email, and filters by source, inside one workspace", async () => {
    expect((await listContacts(a)).map((c) => c.name).sort()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect((await listContacts(a, { q: "lovel" })).map((c) => c.name)).toEqual(["Ada Lovelace"]);
    expect((await listContacts(a, { q: "900456" })).map((c) => c.name)).toEqual(["Grace Hopper"]);
    expect((await listContacts(a, { q: "ada@example" })).map((c) => c.name)).toEqual(["Ada Lovelace"]);
    expect((await listContacts(a, { source: "form" })).map((c) => c.name)).toEqual(["Grace Hopper"]);
    expect(await listContacts(a, { q: "bob" })).toHaveLength(0);
    expect(await listContacts(a, { q: "%" })).toHaveLength(0);
  });

  it("the detail shows all conversations and appointments, and nothing from another workspace", async () => {
    const [svc] = await db.insert(services).values({ workspaceId: a, name: "Cut", durationMin: 30, bufferMin: 0 }).returning();
    await db.insert(conversations).values({ workspaceId: a, channel: "phone", contactId: ada, externalId: "c1" });
    await db.insert(appointments).values({
      workspaceId: a,
      contactId: ada,
      serviceId: svc.id,
      source: "admin",
      startAt: new Date("2030-01-01T10:00:00Z"),
      endAt: new Date("2030-01-01T10:30:00Z"),
      blockedUntil: new Date("2030-01-01T10:30:00Z"),
    });
    const found = await getContact(a, ada);
    expect(found?.conversations).toHaveLength(1);
    expect(found?.appointments).toMatchObject([{ service: "Cut", status: "booked" }]);
    expect(await getContact(b, ada)).toBeNull();
  });

  it("POST creates a contact with a normalised phone and rejects a bad number", async () => {
    const ok = await contactsRoute.POST(json({ workspaceId: a, name: "New", phone: "07700 900321" }, "POST") as never);
    expect(ok.status).toBe(201);
    expect((await listContacts(a, { q: "New" }))[0].phoneE164).toBe("+447700900321");
    const bad = await contactsRoute.POST(json({ workspaceId: a, name: "Bad", phone: "123" }, "POST") as never);
    expect(bad.status).toBe(422);
  });

  it("PATCH edits a contact and refuses one from another workspace", async () => {
    const ok = await contactsRoute.PATCH(json({ workspaceId: a, id: ada, notes: "Prefers mornings", tags: ["vip"] }, "PATCH") as never);
    expect(ok.status).toBe(200);
    expect((await getContact(a, ada))?.contact).toMatchObject({ notes: "Prefers mornings", tags: ["vip"] });
    const other = await contactsRoute.PATCH(json({ workspaceId: a, id: bobInB, notes: "x" }, "PATCH") as never);
    expect(other.status).toBe(404);
  });

  it("routes need an admin session", async () => {
    session = null;
    const res = await contactsRoute.GET(new Request(`http://localhost/api/contacts?workspaceId=${a}`) as never);
    expect(res.status).toBe(401);
  });
});

describe("conversations", () => {
  it("lists newest first and shows tool rows with transcript in time order", async () => {
    const [c] = await db
      .insert(conversations)
      .values({ workspaceId: a, channel: "web_voice", contactId: ada, externalId: "c2", summary: "Booked a cut", durationS: 75 })
      .returning();
    await db.insert(messages).values([
      { workspaceId: a, conversationId: c.id, role: "assistant", content: "Hello", createdAt: new Date("2030-01-01T10:00:00Z") },
      { workspaceId: a, conversationId: c.id, role: "tool_call", toolName: "check_availability", content: "{}", createdAt: new Date("2030-01-01T10:00:05Z") },
      { workspaceId: a, conversationId: c.id, role: "tool_result", toolName: "check_availability", content: "Free at 10", createdAt: new Date("2030-01-01T10:00:06Z") },
      { workspaceId: a, conversationId: c.id, role: "user", content: "Ten please", createdAt: new Date("2030-01-01T10:00:10Z") },
    ]);
    const list = await listConversations(a);
    expect(list).toMatchObject([{ id: c.id, contactName: "Ada Lovelace", durationS: 75, summary: "Booked a cut" }]);
    const found = await getConversation(a, c.id);
    expect(found?.messages.map((m) => m.role)).toEqual(["assistant", "tool_call", "tool_result", "user"]);
    expect(found?.contact?.name).toBe("Ada Lovelace");
    expect(await getConversation(b, c.id)).toBeNull();
    expect(await listConversations(b)).toHaveLength(0);
  });

  it("the API lists only the requested workspace and needs a session", async () => {
    await db.insert(conversations).values({ workspaceId: a, channel: "phone", externalId: "c3" });
    const res = await conversationsRoute.GET(new Request(`http://localhost/api/conversations?workspaceId=${a}`) as never);
    expect((await res.json()).conversations).toHaveLength(1);
    const none = await conversationsRoute.GET(new Request(`http://localhost/api/conversations?workspaceId=${b}`) as never);
    expect((await none.json()).conversations).toHaveLength(0);
    session = null;
    expect((await conversationsRoute.GET(new Request(`http://localhost/api/conversations?workspaceId=${a}`) as never)).status).toBe(401);
  });
});
