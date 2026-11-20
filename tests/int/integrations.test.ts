import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { integrations, workspaces } from "@/lib/db/schema";

let session: { email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));

const { getIntegration, getExactIntegration, saveIntegration } = await import("@/lib/integrations/store");
const { GET, PUT } = await import("@/app/api/integrations/[provider]/route");
const { POST: testRoute } = await import("@/app/api/integrations/[provider]/test/route");
const { createWorkspace } = await import("@/lib/workspaces");

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) }) as never;
const put = (provider: string, data: unknown, query = "") =>
  PUT(new Request(`http://localhost/api/integrations/${provider}${query}`, { method: "PUT", body: JSON.stringify(data) }), ctx(provider));
const get = (provider: string, query = "") => GET(new Request(`http://localhost/api/integrations/${provider}${query}`), ctx(provider));

let workspaceId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
});
beforeEach(async () => {
  session = { email: "admin@example.com" };
  await db.delete(integrations);
  await db.delete(workspaces).where(inArray(workspaces.slug, ["int-ws"]));
  const created = await createWorkspace({
    name: "Int",
    slug: "int-ws",
    niche: "",
    country: "GB",
    timezone: "Europe/London",
    phoneDisplay: "",
    vapiMode: "own",
    businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
  });
  workspaceId = "workspace" in created ? created.workspace.id : "";
});
afterAll(async () => {
  await db.delete(integrations);
  await db.delete(workspaces).where(eq(workspaces.slug, "int-ws"));
});

describe("getIntegration", () => {
  it("prefers the workspace row, then the global row, then nothing", async () => {
    expect(await getIntegration("vapi", workspaceId)).toBeNull();

    await saveIntegration("vapi", null, { privateKey: "global" }, {});
    expect((await getIntegration("vapi", workspaceId))?.creds.privateKey).toBe("global");

    await saveIntegration("vapi", workspaceId, { privateKey: "mine" }, {});
    expect((await getIntegration("vapi", workspaceId))?.creds.privateKey).toBe("mine");
    expect((await getExactIntegration("vapi", null))?.creds.privateKey).toBe("global");
  });

  it("saving the same scope twice updates one row", async () => {
    await saveIntegration("resend", null, { apiKey: "a" }, {});
    await saveIntegration("resend", null, { apiKey: "b" }, {});
    expect(await db.select().from(integrations)).toHaveLength(1);
  });
});

describe("integrations API", () => {
  it("stores secrets encrypted and GET never returns one", async () => {
    await put("telegram", { credentials: { botToken: "123456:SECRET-TOKEN" }, config: { chatId: "42" } });

    const [row] = await db.select().from(integrations);
    expect(row.credentialsEncrypted).not.toContain("SECRET-TOKEN");
    expect(JSON.parse(decrypt(row.credentialsEncrypted!))).toEqual({ botToken: "123456:SECRET-TOKEN" });

    const text = await (await get("telegram")).text();
    expect(text).not.toContain("SECRET-TOKEN");
    expect(JSON.parse(text)).toMatchObject({ credentials: { botToken: "****OKEN" }, config: { chatId: "42" } });
  });

  it("a masked or blank secret keeps the stored one", async () => {
    await put("telegram", { credentials: { botToken: "123456:SECRET-TOKEN" }, config: {} });
    const masked = (await (await get("telegram")).json()).credentials.botToken;

    await put("telegram", { credentials: { botToken: masked }, config: { chatId: "9" } });
    await put("telegram", { credentials: { botToken: "" } });

    const row = await getExactIntegration("telegram", null);
    expect(row?.creds.botToken).toBe("123456:SECRET-TOKEN");
    expect(row?.config.chatId).toBe("9");

    await put("telegram", { credentials: { botToken: "new-token-value" } });
    expect((await getExactIntegration("telegram", null))?.creds.botToken).toBe("new-token-value");
  });

  it("keeps global and workspace rows apart and rejects unknown fields and providers", async () => {
    await put("vapi", { credentials: { privateKey: "global-key" } });
    await put("vapi", { credentials: { privateKey: "ws-key" } }, `?workspaceId=${workspaceId}`);
    expect((await (await get("vapi")).json()).credentials.privateKey).toBe("****-key");
    expect((await getExactIntegration("vapi", workspaceId))?.creds.privateKey).toBe("ws-key");

    expect((await put("vapi", { credentials: { nope: "x" } })).status).toBe(422);
    expect((await put("nope", {})).status).toBe(404);
    expect((await get("vapi", "?workspaceId=not-a-uuid")).status).toBe(422);
  });

  it("test route needs saved keys, and requires an admin", async () => {
    const call = () => testRoute(new Request("http://localhost/t", { method: "POST" }), { params: Promise.resolve({ provider: "vapi" }) } as never);
    expect((await call()).status).toBe(422);
    session = null;
    expect((await call()).status).toBe(401);
    session = { email: "stranger@example.com" };
    expect((await call()).status).toBe(403);
    expect((await get("vapi")).status).toBe(403);
  });
});
