import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { http, HttpResponse } from "msw";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sweep } from "@/app/api/cron/sweep/route";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistants, assistantSyncs, phoneNumberChanges, phoneNumbers, workspaces } from "@/lib/db/schema";
import { saveIntegration } from "@/lib/integrations/store";
import { testEnv } from "../test-env";
import { googleServer as server, startGoogle } from "./helpers/world";

let session: { email: string } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session } }) } }),
}));

const assignRoute = await import("@/app/api/workspaces/[id]/phone-numbers/route");
const reassignRoute = await import("@/app/api/workspaces/[id]/phone-numbers/reassign/route");

type RemoteNumber = {
  id: string;
  number: string | null;
  assistantId: string | null;
  status: string;
  squadId?: string;
  server?: { url: string };
};
const api = "https://api.vapi.ai/phone-number";
const remote = new Map<string, RemoteNumber>();
const patches: { id: string; assistantId: string | null }[] = [];
const loseResponse = new Set<string>();
let ignoreDetach = false;
let beforePatch: (() => Promise<void>) | undefined;

function addNumber(id: string, number: string | null, binding: string | null = null, overrides?: Partial<RemoteNumber>) {
  remote.set(id, { id, number, assistantId: binding, status: "active", ...overrides });
}

async function tenant(slug: string) {
  const [workspace] = await db.insert(workspaces).values({ slug, name: slug, webhookSecretEncrypted: encrypt("secret") }).returning();
  const [assistant] = await db.insert(assistants).values({
    workspaceId: workspace.id, personaName: slug, firstMessage: "AI", systemPrompt: "Receive calls.",
  }).returning();
  const vapiId = `vapi-${slug}`;
  await db.insert(assistantSyncs).values({ workspaceId: workspace.id, assistantId: assistant.id, vapiAssistantId: vapiId });
  return { workspaceId: workspace.id, assistantId: assistant.id, vapiId };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;
let source: Tenant;
let destination: Tenant;
let other: Tenant;

const shared = { id: "shared", number: "+12025550101" };
const previous = { id: "previous", number: "+12025550102" };
const spare = { id: "spare", number: "+12025550103" };

async function own(tenant: Tenant, number: typeof shared, routeTo: string | null = tenant.vapiId) {
  addNumber(number.id, number.number, routeTo);
  const [row] = await db.insert(phoneNumbers).values({
    workspaceId: tenant.workspaceId, assistantId: tenant.assistantId, vapiPhoneNumberId: number.id, e164: number.number,
  }).returning();
  return row;
}

const ctx = ({ workspaceId }: Tenant) => ({ params: Promise.resolve({ id: workspaceId }) });
function assign(tenant: Tenant, id: string, data: Record<string, unknown> = {}) {
  return assignRoute.POST(new Request("http://localhost/numbers", {
    method: "POST", body: JSON.stringify({ vapiPhoneNumberId: id, ...data }),
  }), ctx(tenant));
}
function transfer(tenant: Tenant, from: Tenant, id: string, operationId = crypto.randomUUID()) {
  return reassignRoute.POST(new Request("http://localhost/numbers/reassign", {
    method: "POST", body: JSON.stringify({ vapiPhoneNumberId: id, sourceWorkspaceId: from.workspaceId, operationId }),
  }), ctx(tenant));
}
function list(tenant: Tenant, operationId?: string) {
  return assignRoute.GET(new Request(`http://localhost/numbers${operationId ? `?operationId=${operationId}` : ""}`), ctx(tenant));
}

const assignments = () => db.select().from(phoneNumbers);
const change = async (id: string) =>
  (await db.select().from(phoneNumberChanges).where(eq(phoneNumberChanges.id, id)))[0];
async function runSweep(id: string) {
  await db.update(phoneNumberChanges).set({ reconcileAt: new Date(0) }).where(eq(phoneNumberChanges.id, id));
  const response = await sweep(new Request("http://localhost/api/cron/sweep", {
    headers: { authorization: `Bearer ${testEnv.CRON_SECRET}` },
  }));
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await startGoogle();
});
afterAll(() => server.close());
beforeEach(async () => {
  await db.execute(sql`truncate workspaces, integrations cascade`);
  source = await tenant("source");
  destination = await tenant("destination");
  other = await tenant("other");
  await saveIntegration("vapi", null, { privateKey: "shared-account" }, {});
  session = { email: "admin@example.com" };
  remote.clear();
  patches.length = 0;
  loseResponse.clear();
  ignoreDetach = false;
  beforePatch = undefined;
  server.resetHandlers();
  server.use(
    http.get(api, () => HttpResponse.json([...remote.values()])),
    http.get(`${api}/:id`, ({ params }) => {
      const number = remote.get(String(params.id));
      return number ? HttpResponse.json(number) : new HttpResponse(null, { status: 404 });
    }),
    http.patch(`${api}/:id`, async ({ params, request }) => {
      const id = String(params.id);
      const number = remote.get(id);
      if (!number) return new HttpResponse(null, { status: 404 });
      const { assistantId } = await request.json() as { assistantId: string | null };
      patches.push({ id, assistantId });
      await beforePatch?.();
      if (assistantId !== null || !ignoreDetach) number.assistantId = assistantId;
      return loseResponse.delete(id) ? HttpResponse.error() : HttpResponse.json(number);
    }),
  );
});

describe("Vapi phone numbers", () => {
  it("only lists available E.164 numbers and ignores the browser-supplied phone value", async () => {
    const owned = await own(source, shared);
    addNumber(spare.id, "+1 202-555-0103");
    addNumber("externally-bound", "+12025550104", "foreign-assistant");
    addNumber("squad", "+12025550105", null, { squadId: "foreign-squad" });
    addNumber("server", "+12025550106", null, { server: { url: "https://example.com/inbound" } });
    addNumber("inactive", "+12025550107", null, { status: "activating" });
    addNumber("sip-only", null);
    expect(await (await list(destination)).json()).toMatchObject({ numbers: [spare], assigned: null });
    expect(await (await list(source)).json()).toMatchObject({ numbers: [spare], assigned: shared });

    const response = await assign(destination, spare.id, { e164: "+12025550999" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ phoneNumber: { workspaceId: destination.workspaceId, e164: spare.number } });
    expect(await assignments()).toEqual(expect.arrayContaining([
      owned, expect.objectContaining({ workspaceId: destination.workspaceId, vapiPhoneNumberId: spare.id, e164: spare.number }),
    ]));
    expect(remote.get(shared.id)?.assistantId).toBe(source.vapiId);
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
    expect(await (await list(destination)).json()).toMatchObject({ numbers: [], assigned: spare });
  });

  it.each(["active", "unbound"] as const)("rejects covert reassignment of a locally owned number with an %s Vapi binding", async binding => {
    const assistantId = binding === "active" ? source.vapiId : null;
    const owned = await own(source, shared, assistantId);
    const current = await own(destination, previous);
    expect(await (await list(destination)).json()).toMatchObject({ numbers: [] });
    expect((await assign(destination, shared.id, { sourceWorkspaceId: source.workspaceId })).status).toBe(409);
    expect(await assignments()).toEqual(expect.arrayContaining([owned, current]));
    expect(remote.get(shared.id)?.assistantId).toBe(assistantId);
    expect(remote.get(previous.id)?.assistantId).toBe(destination.vapiId);
    expect(patches).toEqual([]);
  });

  it("preserves stale remote bindings with no local owner and does not take over external routing", async () => {
    addNumber(shared.id, shared.number, source.vapiId);
    addNumber(spare.id, spare.number, null, { squadId: "foreign-squad" });
    expect((await assign(destination, shared.id)).status).toBe(409);
    expect((await assign(destination, spare.id)).status).toBe(409);
    expect(await assignments()).toEqual([]);
    expect(remote.get(shared.id)?.assistantId).toBe(source.vapiId);
    expect(remote.get(spare.id)).toMatchObject({ assistantId: null, squadId: "foreign-squad" });
    expect(patches).toEqual([]);
  });

  it("binds the replacement and detaches the old number before removing its local mapping", async () => {
    await own(destination, previous);
    addNumber(spare.id, spare.number);
    expect((await assign(destination, spare.id)).status).toBe(200);
    expect(await assignments()).toMatchObject([{ workspaceId: destination.workspaceId, vapiPhoneNumberId: spare.id, e164: spare.number }]);
    expect(patches).toEqual([
      { id: spare.id, assistantId: destination.vapiId },
      { id: previous.id, assistantId: null },
    ]);
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(await (await list(other)).json()).toMatchObject({ numbers: [previous] });
  });

  it("rejects a replacement when the previous number has drifted to another remote assistant", async () => {
    const owned = await own(destination, previous, other.vapiId);
    addNumber(spare.id, spare.number);
    expect((await assign(destination, spare.id)).status).toBe(409);
    expect(await assignments()).toEqual([owned]);
    expect(remote.get(previous.id)?.assistantId).toBe(other.vapiId);
    expect(remote.get(spare.id)?.assistantId).toBeNull();
    expect(patches).toEqual([]);
  });

  it("rejects a replacement when Vapi reports a different number for the old binding", async () => {
    const owned = await own(destination, previous);
    const differentNumber = "+12025550104";
    addNumber(previous.id, differentNumber, destination.vapiId);
    addNumber(spare.id, spare.number);
    const operationId = crypto.randomUUID();

    expect((await assign(destination, spare.id, { operationId })).status).toBe(409);
    expect(await change(operationId)).toMatchObject({ status: "rejected", reconcileAt: null });
    expect(await assignments()).toEqual([owned]);
    expect(remote.get(previous.id)).toMatchObject({ number: differentNumber, assistantId: destination.vapiId });
    expect(remote.get(spare.id)?.assistantId).toBeNull();
    expect(patches).toEqual([]);
  });

  it("rejects a deliberate transfer when the source number or binding has changed in Vapi", async () => {
    const original = await own(source, shared);
    const current = await own(destination, previous);
    const reassignChoices = () => reassignRoute.GET(new Request("http://localhost/numbers/reassign"), ctx(destination));
    expect(await (await reassignChoices()).json()).toMatchObject({
      transfers: [{ ...shared, workspaceId: source.workspaceId }],
    });

    for (const { number, assistantId } of [
      { number: shared.number, assistantId: other.vapiId },
      { number: "+12025550104", assistantId: source.vapiId },
    ]) {
      addNumber(shared.id, number, assistantId);
      const operationId = crypto.randomUUID();
      expect((await transfer(destination, source, shared.id, operationId)).status).toBe(409);
      expect(await change(operationId)).toMatchObject({ status: "rejected", reconcileAt: null });
      expect(await (await reassignChoices()).json()).toEqual({ transfers: [] });
      expect(await assignments()).toEqual(expect.arrayContaining([original, current]));
      expect(remote.get(shared.id)).toMatchObject({ number, assistantId });
      expect(remote.get(previous.id)?.assistantId).toBe(destination.vapiId);
      expect(patches).toEqual([]);
    }
  });

  it("moves a confirmed shared number through the separate reassign route and detaches the destination's old number", async () => {
    const owned = await own(source, shared);
    await own(destination, previous);
    const choices = await reassignRoute.GET(new Request("http://localhost/numbers/reassign"), ctx(destination));
    expect(await choices.json()).toEqual({ transfers: [{ ...shared, workspaceId: source.workspaceId, workspaceName: "source" }] });
    expect((await transfer(destination, other, shared.id)).status).toBe(409);
    const operationId = crypto.randomUUID();
    const response = await transfer(destination, source, shared.id, operationId);
    expect(response.status).toBe(200);
    expect((await transfer(destination, source, shared.id, operationId)).status).toBe(200);
    expect(await assignments()).toMatchObject([{ id: owned.id, workspaceId: destination.workspaceId, assistantId: destination.assistantId, e164: shared.number }]);
    expect(remote.get(shared.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(patches).toHaveLength(2);
    expect(await change(operationId)).toMatchObject({ status: "completed", sourceWorkspaceId: source.workspaceId });
    expect(await (await list(source)).json()).toMatchObject({ assigned: null, operation: null });
  });

  it("prevents concurrent admins claiming the same number or replacing an in-flight assignment", async () => {
    addNumber(shared.id, shared.number);
    addNumber(spare.id, spare.number);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    beforePatch = () => {
      entered.resolve();
      return release.promise;
    };
    const first = assign(source, shared.id);
    try {
      await entered.promise;
      const [racingOwner, racingReplacement, available] = await Promise.all([
        assign(destination, shared.id),
        assign(source, spare.id),
        list(destination),
      ]);
      expect(racingOwner.status).toBe(409);
      expect(racingReplacement.status).toBe(409);
      expect(await available.json()).toMatchObject({ numbers: [spare] });
      expect(await assignments()).toEqual([]);
      expect(remote.get(shared.id)?.assistantId).toBeNull();
    } finally {
      release.resolve();
      expect((await first).status).toBe(200);
    }
    expect(await assignments()).toMatchObject([{ workspaceId: source.workspaceId, vapiPhoneNumberId: shared.id }]);
    expect(remote.get(shared.id)?.assistantId).toBe(source.vapiId);
    expect(remote.get(spare.id)?.assistantId).toBeNull();
    expect(patches).toHaveLength(1);
  });

  it("reconciles a transfer accepted by Vapi with a lost response and reserves both workspaces while pending", async () => {
    const original = await own(source, shared);
    const old = await own(destination, previous);
    addNumber(spare.id, spare.number);
    loseResponse.add(shared.id);
    const operationId = crypto.randomUUID();

    expect((await transfer(destination, source, shared.id, operationId)).status).toBe(202);
    expect(await assignments()).toEqual(expect.arrayContaining([original, old]));
    expect(await change(operationId)).toMatchObject({ status: "applying" });
    expect(remote.get(shared.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(previous.id)?.assistantId).toBe(destination.vapiId);
    expect((await assign(source, spare.id)).status).toBe(409);
    expect((await assign(destination, spare.id)).status).toBe(409);
    expect(await (await list(source, operationId)).json()).toMatchObject({ change: { status: "applying" }, operation: null });
    server.use(http.get(api, () => new HttpResponse(null, { status: 503 }), { once: true }));
    expect(await (await list(destination, operationId)).json()).toMatchObject({
      numbers: [], assigned: previous, operation: { status: "applying" }, providerError: expect.any(String),
    });

    const result = await runSweep(operationId);
    expect(result.phoneNumbers).toEqual({ examined: 1, pending: 0 });
    expect(await (await list(destination, operationId)).json()).toMatchObject({ assigned: shared, change: null, operation: { status: "completed" } });
    expect(await assignments()).toMatchObject([{ id: original.id, workspaceId: destination.workspaceId }]);
    expect(remote.get(shared.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(patches).toHaveLength(2);
  });

  it("replays an accepted detach whose response was lost without repeating either remote write", async () => {
    const old = await own(destination, previous);
    addNumber(spare.id, spare.number);
    loseResponse.add(previous.id);
    const operationId = crypto.randomUUID();

    expect((await assign(destination, spare.id, { operationId })).status).toBe(202);
    expect(await assignments()).toEqual([old]);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
    expect((await assign(destination, spare.id, { operationId })).status).toBe(200);
    expect(await assignments()).toMatchObject([{ workspaceId: destination.workspaceId, vapiPhoneNumberId: spare.id }]);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
    expect(patches).toHaveLength(2);
  });

  it("preserves the pending change when Vapi accepts a detach request without clearing the binding", async () => {
    const old = await own(destination, previous);
    addNumber(spare.id, spare.number);
    ignoreDetach = true;
    const operationId = crypto.randomUUID();

    expect((await assign(destination, spare.id, { operationId })).status).toBe(202);
    expect(await assignments()).toEqual([old]);
    expect(await change(operationId)).toMatchObject({ status: "applying", error: expect.stringContaining("detached") });
    expect(remote.get(previous.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
    ignoreDetach = false;
    await runSweep(operationId);
    expect(await assignments()).toMatchObject([{ workspaceId: destination.workspaceId, vapiPhoneNumberId: spare.id }]);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(remote.get(spare.id)?.assistantId).toBe(destination.vapiId);
  });

  it("recovers both remote changes after the local transaction fails", async () => {
    const original = await own(source, shared);
    const old = await own(destination, previous);
    const operationId = crypto.randomUUID();
    await db.execute(sql`create function reject_phone_change() returns trigger language plpgsql as $$
      begin raise exception 'test phone write failure'; end $$`);
    await db.execute(sql`create trigger reject_phone_change before delete on phone_numbers
      for each row execute function reject_phone_change()`);
    try {
      expect((await transfer(destination, source, shared.id, operationId)).status).toBe(202);
      expect(await assignments()).toEqual(expect.arrayContaining([original, old]));
      expect(await change(operationId)).toMatchObject({ status: "applying" });
      expect(remote.get(shared.id)?.assistantId).toBe(destination.vapiId);
      expect(remote.get(previous.id)?.assistantId).toBeNull();
    } finally {
      await db.execute(sql`drop trigger reject_phone_change on phone_numbers`);
      await db.execute(sql`drop function reject_phone_change()`);
    }

    await runSweep(operationId);
    expect(await assignments()).toMatchObject([{ id: original.id, workspaceId: destination.workspaceId }]);
    expect(await change(operationId)).toMatchObject({ status: "completed" });
    expect(remote.get(shared.id)?.assistantId).toBe(destination.vapiId);
    expect(remote.get(previous.id)?.assistantId).toBeNull();
    expect(patches).toHaveLength(2);
  });

  it("requires an admin for reassignment and the cron secret for recovery", async () => {
    const original = await own(source, shared);
    session = null;
    expect((await transfer(destination, source, shared.id)).status).toBe(401);
    expect((await sweep(new Request("http://localhost/api/cron/sweep"))).status).toBe(401);
    expect(await assignments()).toEqual([original]);
    expect(remote.get(shared.id)?.assistantId).toBe(source.vapiId);
    expect(patches).toEqual([]);
  });
});
