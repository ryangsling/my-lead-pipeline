import { eq, sql } from "drizzle-orm";
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
const vapi = vi.hoisted(() => ({
  artifact: { presignedMonoUrl: "https://signed.example/mono.wav?X-Amz-Signature=abc" } as object,
  consent: { type: "verbal", grantedAt: "2026-11-21T09:00:04.000Z" } as object | null,
  callOverrides: {} as { id?: string; createdAt?: string; endedAt?: string },
  calls: [] as { workspaceId: string; path: string }[],
}));
const consentAt = new Date("2026-11-21T09:00:04.000Z");
const recordingUrl = "https://artifact.example/mono.wav";
vi.mock("@/lib/vapi/account", () => ({
  resolveVapiAccount: async (workspaceId: string) => ({ accountId: null, privateKey: workspaceId, publicKey: "" }),
}));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: async (workspaceId: string, path: string) => {
    vapi.calls.push({ workspaceId, path });
    return { id: decodeURIComponent(path.slice("/call/".length)), ...vapi.callOverrides,
      artifact: vapi.artifact, compliance: { recordingConsent: vapi.consent } };
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
  vapi.consent = { type: "verbal", grantedAt: consentAt.toISOString() };
  vapi.callOverrides = {};
  vapi.calls = [];
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
    .values({ workspaceId: a, channel: "web_voice", externalId: "call_rec", recordingUrl, recordingConsentAt: consentAt })
    .returning({ id: conversations.id });
});

describe("recording redirect", () => {
  it("retrieves a new signed link on each request without caching the redirect", async () => {
    const res = await get(conversationId, a);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed.example/mono.wav?X-Amz-Signature=abc");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    vapi.artifact = { presignedMonoUrl: "https://signed.example/mono.wav?X-Amz-Signature=fresh" };
    expect((await get(conversationId, a)).headers.get("location")).toBe("https://signed.example/mono.wav?X-Amz-Signature=fresh");
    expect(vapi.calls).toEqual([
      { workspaceId: a, path: "/call/call_rec" },
      { workspaceId: a, path: "/call/call_rec" },
    ]);
  });

  it("requires the conversation's workspace and lets an allowlisted admin select either workspace", async () => {
    expect((await get(conversationId, b)).status).toBe(404);
    expect(vapi.calls).toEqual([]);
    const [other] = await db.insert(conversations).values({
      workspaceId: b, channel: "web_voice", externalId: "call_other", recordingUrl, recordingConsentAt: consentAt,
    }).returning({ id: conversations.id });
    expect((await get(other.id, b)).status).toBe(302);
    expect(vapi.calls).toEqual([{ workspaceId: b, path: "/call/call_other" }]);
  });

  it("answers 404 when Vapi has no recording and 401 without a session", async () => {
    vapi.artifact = {};
    expect((await get(conversationId, a)).status).toBe(404);
    session = { email: "non-admin@example.com" };
    expect((await get(conversationId, a)).status).toBe(403);
    session = null;
    expect((await get(conversationId, a)).status).toBe(401);
    expect(vapi.calls).toEqual([{ workspaceId: a, path: "/call/call_rec" }]);
  });

  it("never requests a signed link for a legacy recording with no stored consent", async () => {
    const [legacy] = await db.insert(conversations).values({
      workspaceId: a, channel: "phone", externalId: "call_legacy", recordingUrl,
    }).returning({ id: conversations.id });
    expect((await get(legacy.id, a)).status).toBe(404);
    expect(vapi.calls).toEqual([]);
  });

  it("never redirects if Vapi omits or contradicts the stored consent", async () => {
    vapi.consent = null;
    expect((await get(conversationId, a)).status).toBe(404);
    vapi.consent = { type: "stay-on-line", grantedAt: consentAt.toISOString() };
    expect((await get(conversationId, a)).status).toBe(404);
    vapi.consent = { type: "verbal", grantedAt: "2026-11-21T09:00:05.000Z" };
    expect((await get(conversationId, a)).status).toBe(404);
  });

  it.each([
    { name: "a different call ID", overrides: { id: "another-call" } },
    { name: "consent before the call was created", overrides: { createdAt: "2026-11-21T09:00:05.000Z" } },
    { name: "consent after the call ended", overrides: { endedAt: "2026-11-21T09:00:03.000Z" } },
  ])("withholds the signed link when Vapi reports $name", async ({ overrides }) => {
    vapi.callOverrides = overrides;
    const res = await get(conversationId, a);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(vapi.calls).toEqual([{ workspaceId: a, path: "/call/call_rec" }]);
    expect(await db.select().from(conversations).where(eq(conversations.id, conversationId))).toMatchObject([
      { workspaceId: a, externalId: "call_rec", recordingUrl, recordingConsentAt: consentAt },
    ]);
  });
});
