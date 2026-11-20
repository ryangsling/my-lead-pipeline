import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { conversations, workspaces } from "@/lib/db/schema";

let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));
const vapi = vi.hoisted(() => ({ artifact: { presignedMonoUrl: "https://signed.example/mono.wav?X-Amz-Signature=abc" } as object, paths: [] as string[] }));
vi.mock("@/lib/vapi/account", () => ({ resolveVapiAccount: async () => ({ accountId: null, privateKey: "k", publicKey: "" }) }));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: async (_key: string, path: string) => {
    vapi.paths.push(path);
    return { artifact: vapi.artifact };
  },
}));

const route = await import("@/app/api/conversations/[id]/recording/route");

let a: string;
let b: string;
let conversationId: string;

const get = (id: string, workspaceId: string) =>
  route.GET(new Request(`http://localhost/x?workspaceId=${workspaceId}`) as never, { params: Promise.resolve({ id }) } as never);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  session = { email: "admin@example.com" };
  vapi.artifact = { presignedMonoUrl: "https://signed.example/mono.wav?X-Amz-Signature=abc" };
  vapi.paths = [];
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
  [{ id: conversationId }] = await db
    .insert(conversations)
    .values({ workspaceId: a, channel: "web_voice", externalId: "call_rec" })
    .returning({ id: conversations.id });
});

describe("recording redirect", () => {
  it("redirects to a fresh signed link from Vapi", async () => {
    const res = await get(conversationId, a);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed.example/mono.wav?X-Amz-Signature=abc");
    expect(vapi.paths).toEqual(["/call/call_rec"]);
  });

  it("does not serve a conversation from another workspace", async () => {
    expect((await get(conversationId, b)).status).toBe(404);
    expect(vapi.paths).toEqual([]);
  });

  it("answers 404 when Vapi has no recording and 401 without a session", async () => {
    vapi.artifact = {};
    expect((await get(conversationId, a)).status).toBe(404);
    session = null;
    expect((await get(conversationId, a)).status).toBe(401);
  });
});
