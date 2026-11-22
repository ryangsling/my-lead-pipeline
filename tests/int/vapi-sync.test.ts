import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, phoneNumberChanges, phoneNumbers, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { saveIntegration } from "@/lib/integrations/store";
import { authenticateVapi } from "@/lib/vapi/auth";
import type { buildAssistantConfig } from "@/lib/vapi/assistant-config";
import { changePhoneNumber } from "@/lib/vapi/phone-numbers";
import { createWorkspace } from "@/lib/workspaces";

const { syncAssistant } = await import("@/lib/vapi/sync");

const server = setupServer();
const vapi = "https://api.vapi.ai";
const appUrl = env.APP_URL;
const endpoints = ["tool", "structured-output", "assistant"] as const;
type Endpoint = typeof endpoints[number];
type ToolBody = { function: { name: string }; server: { url: string; headers: Record<string, string> } };
type OutputBody = { name: string; schema: { properties: Record<string, unknown> } };
type AssistantBody = ReturnType<typeof buildAssistantConfig>;
type RemoteResource = { id: string; createdAt: string } & Record<string, unknown>;
type Number = { id: string; number: string; status: string; assistantId: string | null; workflowId?: string };
type Writes = { create: string[]; patch: string[]; listed: number };

function mockVapi() {
  const resources = Object.fromEntries(endpoints.map(endpoint => [endpoint, new Map<string, RemoteResource>()])) as
    Record<Endpoint, Map<string, RemoteResource>>;
  const writes = Object.fromEntries(endpoints.map<[Endpoint, Writes]>(endpoint => [endpoint, { create: [], patch: [], listed: 0 }])) as
    Record<Endpoint, Writes>;
  const numbers = new Map<string, Number>();
  const phoneReads: string[] = [];
  const phoneWrites: string[] = [];
  let losePhoneResponse = false;
  let fail: { method: "create" | "patch"; resource: Endpoint; status?: number; accepted?: boolean } | undefined;
  let beforeCreate: ((endpoint: Endpoint) => Promise<void>) | undefined;
  let dropConsentPlanOnPatch = false;

  const failure = (method: "create" | "patch", resource: Endpoint) => {
    if (fail?.method !== method || fail.resource !== resource) return;
    const current = fail;
    fail = undefined;
    return current;
  };
  const error = (status?: number) => status
    ? HttpResponse.json({ message: status === 402 ? "Insufficient credits" : "Failure" }, { status })
    : HttpResponse.error();
  for (const endpoint of endpoints) {
    const store = resources[endpoint];
    const calls = writes[endpoint];
    server.use(
      http.post(`${vapi}/${endpoint}`, async ({ request }) => {
        await beforeCreate?.(endpoint);
        const body = (await request.json()) as Record<string, unknown>;
        const id = `${endpoint}_${calls.create.length + 1}`;
        calls.create.push(id);
        const attempt = failure("create", endpoint);
        if (attempt && !attempt.accepted) return error(attempt.status);
        const resource = { ...body, id, createdAt: new Date().toISOString() };
        store.set(id, resource);
        return attempt ? error(attempt.status) : HttpResponse.json(resource);
      }),
      http.patch(`${vapi}/${endpoint}/:id`, async ({ request, params }) => {
        const id = String(params.id);
        calls.patch.push(id);
        const current = store.get(id);
        if (!current) return error(404);
        const attempt = failure("patch", endpoint);
        if (attempt && !attempt.accepted) return error(attempt.status);
        const body = (await request.json()) as Record<string, unknown>;
        const resource: RemoteResource = { ...current, ...body, id };
        if (endpoint === "assistant" && dropConsentPlanOnPatch) resource.compliancePlan = {};
        store.set(id, resource);
        return attempt ? error(attempt.status) : HttpResponse.json(resource);
      }),
      http.get(`${vapi}/${endpoint}/:id`, ({ params }) => {
        const resource = store.get(String(params.id));
        return resource ? HttpResponse.json(resource) : error(404);
      }),
      http.get(`${vapi}/${endpoint}`, ({ request }) => {
        calls.listed++;
        const query = new URL(request.url).searchParams;
        const name = query.get("name");
        const results = [...store.values()].filter(item => !name || item.name === name);
        return HttpResponse.json(endpoint === "structured-output" ? {
          results, metadata: { totalItems: results.length, itemsPerPage: 100, hasNextPage: false },
        } : results);
      }),
    );
  }
  server.use(
    http.get(`${vapi}/phone-number/:id`, ({ params }) => {
      const id = String(params.id);
      phoneReads.push(id);
      const number = numbers.get(id);
      return number ? HttpResponse.json(number) : error(404);
    }),
    http.patch(`${vapi}/phone-number/:id`, async ({ request, params }) => {
      const id = String(params.id);
      const number = numbers.get(id);
      if (!number) return error(404);
      const { assistantId } = (await request.json()) as { assistantId: string };
      phoneWrites.push(assistantId);
      number.assistantId = assistantId;
      if (losePhoneResponse) {
        losePhoneResponse = false;
        return HttpResponse.error();
      }
      return HttpResponse.json(number);
    }),
  );
  return {
    resources, writes, numbers, phoneReads, phoneWrites,
    assistant: (id: string) => resources.assistant.get(id) as (RemoteResource & AssistantBody) | undefined,
    tool: (id: string) => resources.tool.get(id) as (RemoteResource & ToolBody) | undefined,
    output: (id: string) => resources["structured-output"].get(id) as (RemoteResource & OutputBody) | undefined,
    failNext: (attempt: typeof fail) => { fail = attempt; },
    beforeCreate: (callback: typeof beforeCreate) => { beforeCreate = callback; },
    losePhoneResponse: () => { losePhoneResponse = true; },
    dropConsentPlanOnPatch: () => { dropConsentPlanOnPatch = true; },
    simulateCall: (decision: "yes" | "no" | "silence") => {
      const assistant = resources.assistant.get("assistant_1") as RemoteResource & AssistantBody;
      const plan = assistant.compliancePlan.recordingConsentPlan;
      const spoken = plan ? [plan.message] : [];
      if (plan && decision === "no") spoken.push(plan.declineTool.messages[0].content);
      if (plan && decision !== "yes") return { spoken, recording: [], grantedAt: null };
      spoken.push(assistant.firstMessage);
      return {
        spoken,
        recording: assistant.artifactPlan.recordingEnabled ? assistant.firstMessage.split("\n") : [],
        grantedAt: plan ? "2026-11-21T09:00:04.000Z" : null,
      };
    },
  };
}

const workspaceInput = {
  name: "Vapi Sync",
  slug: "int-vapi-sync",
  niche: "",
  country: "US",
  timezone: "America/New_York",
  phoneDisplay: "",
  vapiMode: "own" as const,
  businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
};

let workspaceId = "";
let assistantId = "";
let remote: ReturnType<typeof mockVapi>;

async function currentSync() {
  const [row] = await db.select().from(assistantSyncs).where(and(eq(assistantSyncs.workspaceId, workspaceId), eq(assistantSyncs.assistantId, assistantId)));
  return row;
}

async function assignPhone(vapiAssistantId: string | null) {
  const id = "phone_us";
  const number = "+12025550123";
  const phone = { id, number, status: "active", assistantId: vapiAssistantId };
  remote.numbers.set(id, phone);
  await db.insert(phoneNumbers).values({ workspaceId, assistantId, vapiPhoneNumberId: id, e164: number });
  return phone;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, workspaceInput.slug));
  remote = mockVapi();
  const created = await createWorkspace(workspaceInput);
  workspaceId = "workspace" in created ? created.workspace.id : "";
  const [assistant] = await db.insert(assistants).values({
    workspaceId,
    personaName: "Sync Receptionist",
    firstMessage: "Hi, I am the AI assistant. This call may be recorded.",
    systemPrompt: "You are the receptionist for {{business_name}}. Today is {{today}}.",
    voiceId: "voice_1",
  }).returning();
  assistantId = assistant.id;
  await saveIntegration("vapi", workspaceId, { privateKey: "private" }, { publicKey: "public" });
});
afterEach(() => {
  server.resetHandlers();
  env.APP_URL = appUrl;
  env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = "";
});
afterAll(async () => {
  server.close();
  await db.delete(workspaces).where(eq(workspaces.slug, workspaceInput.slug));
});

describe("syncAssistant", () => {
  it("keeps workspace requests unrecorded until that workspace is approved", async () => {
    await db.update(workspaces).set({ recordingEnabled: true }).where(eq(workspaces.id, workspaceId));
    env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = crypto.randomUUID();
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_1", syncError: null });
    expect(remote.assistant("assistant_1")).toMatchObject({
      artifactPlan: { recordingEnabled: false, videoRecordingEnabled: false, pcapEnabled: false },
      monitorPlan: { listenEnabled: false, controlEnabled: false },
      compliancePlan: {},
    });
    expect(remote.simulateCall("silence")).toEqual({
      spoken: ["Hi, this is the AI assistant for Vapi Sync. This call will continue without an audio recording."],
      recording: [], grantedAt: null,
    });
  });

  it("sends a provider consent plan and a fixed first line for the approved recorded flow", async () => {
    env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = workspaceId;
    await db.update(workspaces).set({ recordingEnabled: true }).where(eq(workspaces.id, workspaceId));
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_1", syncError: null });
    expect(remote.assistant("assistant_1")?.artifactPlan.recordingEnabled).toBe(true);
    const consent = "Hi, this is the AI assistant for Vapi Sync. May we record this call? Please say yes or no.";
    const yes = remote.simulateCall("yes");
    expect(yes.spoken[0]).toBe(consent);
    expect(yes.grantedAt).toBeTruthy();
    expect(yes.recording[0]).toBe("This call is being recorded.");
    expect(remote.simulateCall("no")).toEqual({
      spoken: [consent, "Please use the business's website for another way to get in touch. Goodbye."],
      recording: [], grantedAt: null,
    });
    expect(remote.simulateCall("silence")).toEqual({ spoken: [consent], recording: [], grantedAt: null });
  });

  it("disables previously recorded calls before staging dependencies, even if the sync then fails", async () => {
    env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = workspaceId;
    await db.update(workspaces).set({ recordingEnabled: true }).where(eq(workspaces.id, workspaceId));
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    expect(remote.simulateCall("yes").recording).toHaveLength(2);
    env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = "";
    env.APP_URL = "https://changed.example.test";
    remote.failNext({ method: "create", resource: "tool", status: 503 });
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
    expect(remote.assistant("assistant_1")).toMatchObject({
      artifactPlan: { recordingEnabled: false, structuredOutputIds: ["structured-output_1"] },
      compliancePlan: {},
    });
    expect(remote.simulateCall("yes").recording).toEqual([]);
  });

  it("returns to the unrecorded policy when Vapi does not confirm the requested consent plan", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS = workspaceId;
    await db.update(workspaces).set({ recordingEnabled: true }).where(eq(workspaces.id, workspaceId));
    remote.dropConsentPlanOnPatch();
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({
      ok: false, error: "Vapi did not confirm the requested call recording policy. The assistant was set to unrecorded.",
    });
    expect(remote.simulateCall("yes").recording).toEqual([]);
    expect(remote.assistant("assistant_1")?.firstMessage).toContain("without an audio recording");
  });

  it("rejects an assistant outside the selected workspace before Vapi activity", async () => {
    const [other] = await db.insert(workspaces).values({
      name: "Another workspace", slug: "int-vapi-sync-other", webhookSecretEncrypted: "unused",
    }).returning();
    try {
      await saveIntegration("vapi", other.id, { privateKey: "private" }, { publicKey: "public" });
      expect(await syncAssistant(other.id, assistantId)).toEqual({ ok: false, error: "Assistant not found" });
      expect(await currentSync()).toBeUndefined();
      for (const calls of Object.values(remote.writes)) expect(calls).toEqual({ create: [], patch: [], listed: 0 });
      expect(remote.phoneReads).toEqual([]);
      expect(remote.phoneWrites).toEqual([]);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, other.id));
    }
  });

  it("publishes the checkpointed tools, structured output, and assistant", async () => {
    const result = await syncAssistant(workspaceId, assistantId);
    expect(result).toEqual({ ok: true, vapiAssistantId: "assistant_1" });

    const sync = await currentSync();
    expect(sync).toMatchObject({
      vapiAssistantId: "assistant_1",
      vapiToolIds: {
        notify_urgent: "tool_1", check_availability: "tool_2", book_appointment: "tool_3", capture_lead: "tool_4",
      },
      structuredOutputIds: ["structured-output_1"],
      syncError: null,
      syncLeaseId: null,
    });
    expect(sync.desiredConfigHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sync.appliedConfigHash).toBe(sync.desiredConfigHash);
    expect(Object.values(sync.resourceCheckpoints).map(resource => resource.remoteId).sort()).toEqual([
      "assistant_1", "structured-output_1", "tool_1", "tool_2", "tool_3", "tool_4",
    ]);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws.transferEnabled).toBe(false);
    const assistant = remote.assistant("assistant_1");
    expect(assistant?.model.tools).toBeUndefined();
    const secret = decrypt(ws.webhookSecretEncrypted);
    expect(assistant?.server.headers["x-vapi-secret"]).toBe(secret);
    expect(assistant?.server.url).toBe("http://localhost:3000/api/vapi/webhook");
    expect(assistant?.model.toolIds).toEqual(["tool_1", "tool_2", "tool_3", "tool_4"]);
    expect(assistant?.model.messages[0].content).toContain("Vapi Sync");
    expect(assistant?.model.messages[0].content).toContain("call 911 immediately");
    expect(assistant?.model.messages[0].content).toContain("call notify_urgent");
    expect(assistant?.model.messages[0].content).not.toMatch(/transfer/i);
    expect(assistant?.model.messages[0].content).toContain('{{"now" | date:');
    expect(assistant?.voice).toEqual({ provider: "11labs", voiceId: "voice_1", model: "eleven_flash_v2_5" });
    expect(assistant?.artifactPlan.structuredOutputIds).toEqual(["structured-output_1"]);
  });

  it("adds and removes the native transfer tool with the workspace setting", async () => {
    await db.update(workspaces).set({ transferEnabled: true }).where(eq(workspaces.id, workspaceId));
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    expect(remote.assistant("assistant_1")?.model.tools).toMatchObject([{ type: "transferCall" }]);
    await db.update(workspaces).set({ transferEnabled: false }).where(eq(workspaces.id, workspaceId));
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    expect(remote.assistant("assistant_1")?.model.tools).toEqual([]);
  });

  it("reuses unchanged resources and keeps the active assistant ID", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const hash = (await currentSync()).appliedConfigHash;
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    expect(remote.writes.tool).toMatchObject({ create: ["tool_1", "tool_2", "tool_3", "tool_4"], patch: [] });
    expect(remote.writes["structured-output"]).toMatchObject({ create: ["structured-output_1"], patch: [] });
    expect(remote.writes.assistant).toMatchObject({ create: ["assistant_1"], patch: ["assistant_1"] });
    expect((await currentSync()).appliedConfigHash).toBe(hash);
  });

  it("stages versioned resources for a legacy sync row while preserving its assistant", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    await db.update(assistantSyncs).set({
      resourceCheckpoints: {}, desiredConfigHash: null, appliedConfigHash: null,
    }).where(and(eq(assistantSyncs.workspaceId, workspaceId), eq(assistantSyncs.assistantId, assistantId)));

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    expect(remote.writes.assistant).toMatchObject({ create: ["assistant_1"], patch: ["assistant_1"] });
    expect(remote.writes.tool.patch).toEqual([]);
    expect(remote.writes["structured-output"].patch).toEqual([]);
    const live = remote.assistant("assistant_1");
    expect(live?.model.toolIds).toEqual(["tool_5", "tool_6", "tool_7", "tool_8"]);
    expect(live?.artifactPlan.structuredOutputIds).toEqual(["structured-output_2"]);
  });

  it("keeps each successful dependency checkpoint after a rejected assistant create", async () => {
    remote.failNext({ method: "create", resource: "assistant", status: 402 });
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: false, error: "Vapi billing check failed" });
    const failed = await currentSync();
    expect(failed).toMatchObject({ syncError: "Vapi billing check failed", vapiAssistantId: null, appliedConfigHash: null });
    expect(Object.values(failed.resourceCheckpoints)).toHaveLength(5);
    expect(Object.values(failed.resourceCheckpoints).every(resource => resource.remoteId)).toBe(true);
    expect(failed.resourceCheckpoints.assistant).toBeUndefined();

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_2" });
    expect(remote.resources.tool.size).toBe(4);
    expect(remote.resources["structured-output"].size).toBe(1);
    expect(remote.writes.tool.create).toHaveLength(4);
    expect(remote.writes["structured-output"].create).toHaveLength(1);
    expect(remote.writes.assistant.listed).toBe(0);
  });

  it("reuses the confirmed resources after the final database publish fails", async () => {
    await db.execute(sql`create function int_block_sync_publish() returns trigger language plpgsql as
      $$ begin raise exception 'mock final sync write failure'; end; $$`);
    await db.execute(sql`create trigger int_block_sync_publish before update of applied_config_hash on assistant_syncs
      for each row when (new.applied_config_hash is not null) execute function int_block_sync_publish()`);
    try {
      expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
      const interrupted = await currentSync();
      expect(interrupted).toMatchObject({ vapiAssistantId: null, appliedConfigHash: null, syncLeaseId: null });
      expect(interrupted.resourceCheckpoints.assistant).toMatchObject({ remoteId: "assistant_1" });
      expect(remote.assistant("assistant_1")).toMatchObject({
        model: { toolIds: ["tool_1", "tool_2", "tool_3", "tool_4"] },
        artifactPlan: { structuredOutputIds: ["structured-output_1"] },
      });
    } finally {
      await db.execute(sql`drop function int_block_sync_publish() cascade`);
    }

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    const published = await currentSync();
    expect(published.appliedConfigHash).toBe(published.desiredConfigHash);
    expect(published.vapiAssistantId).toBe("assistant_1");
    expect(remote.writes.assistant.create).toEqual(["assistant_1"]);
    expect(remote.writes.tool.create).toHaveLength(4);
    expect(remote.writes["structured-output"].create).toHaveLength(1);
  });

  it.each(endpoints)("reconciles a lost %s create response before resuming", async (endpoint) => {
    remote.failNext({ method: "create", resource: endpoint, accepted: true });
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
    const pending = Object.values((await currentSync()).resourceCheckpoints).filter(resource => !resource.remoteId);
    expect(pending).toHaveLength(1);
    expect(remote.writes[endpoint].create).toHaveLength(1);
    expect(remote.resources[endpoint].size).toBe(1);
    // A decoy with the same display name or function name must not be adopted.
    const [accepted] = remote.resources[endpoint].values();
    remote.resources[endpoint].set("decoy", {
      ...accepted, id: "decoy", server: undefined, metadata: undefined, description: undefined,
    });
    if (endpoint === "assistant") {
      await db.update(assistants).set({ systemPrompt: "Updated during recovery." }).where(eq(assistants.id, assistantId));
    }

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    expect(remote.writes[endpoint].listed).toBe(1);
    expect(remote.writes.tool.create).toHaveLength(4);
    expect(remote.writes["structured-output"].create).toHaveLength(1);
    expect(remote.writes.assistant.create).toHaveLength(1);
    expect(Object.values((await currentSync()).resourceCheckpoints)).toContainEqual({ ...pending[0], remoteId: accepted.id });
    if (endpoint === "assistant") expect(remote.assistant("assistant_1")?.model.messages[0].content).toContain("Updated during recovery.");
  });

  it("preserves an ambiguous intent when the provider inventory has yet to show it", async () => {
    remote.failNext({ method: "create", resource: "tool", status: 503 });
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
    const pending = (await currentSync()).resourceCheckpoints;
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({
      ok: false, error: "Vapi tool creation is awaiting confirmation. Retry sync to check Vapi again.",
    });
    expect((await currentSync()).resourceCheckpoints).toEqual(pending);
    expect(remote.writes.tool).toMatchObject({ create: ["tool_1"], listed: 1 });
  });

  it("serializes concurrent sync calls before either can create the same resource", async () => {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    remote.beforeCreate(async (endpoint) => {
      if (endpoint === "tool" && !remote.writes.tool.create.length) {
        entered.resolve();
        await resume.promise;
      }
    });
    const first = syncAssistant(workspaceId, assistantId);
    try {
      await entered.promise;
      const inFlight = await currentSync();
      expect(inFlight.syncLeaseId).toBeTruthy();
      expect(Object.values(inFlight.resourceCheckpoints)).toMatchObject([{ marker: expect.any(String), remoteId: null }]);
      await expect(syncAssistant(workspaceId, assistantId)).resolves.toEqual({
        ok: false, error: "An assistant sync is already running. Retry after it finishes.",
      });
      expect(remote.writes.tool.create).toHaveLength(0);
    } finally {
      resume.resolve();
      await first;
    }
    expect(await first).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    expect(remote.writes.tool.create).toHaveLength(4);
    expect(remote.writes.assistant.create).toHaveLength(1);
    expect((await currentSync()).syncLeaseId).toBeNull();
  });

  it("leaves the live dependencies untouched when publishing a changed assistant fails", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const firstSync = await currentSync();
    const live = structuredClone(remote.assistant("assistant_1")!);
    const oldTools = live.model.toolIds.map(id => structuredClone(remote.tool(id)));
    const oldOutput = structuredClone(remote.output(live.artifactPlan.structuredOutputIds[0]));

    env.APP_URL = "https://changed.example.test";
    await db.update(assistants).set({ systemPrompt: "A changed prompt.", structuredSchema: ["new_field"] }).where(eq(assistants.id, assistantId));
    remote.failNext({ method: "patch", resource: "assistant", status: 500 });
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
    const failed = await currentSync();
    expect(failed.desiredConfigHash).not.toBe(firstSync.appliedConfigHash);
    expect(failed.appliedConfigHash).toBe(firstSync.appliedConfigHash);
    expect(failed.vapiToolIds).toEqual(firstSync.vapiToolIds);
    expect(failed.structuredOutputIds).toEqual(firstSync.structuredOutputIds);
    expect(remote.assistant("assistant_1")).toEqual(live);
    expect(live.model.toolIds.map(id => remote.tool(id))).toEqual(oldTools);
    expect(remote.output(live.artifactPlan.structuredOutputIds[0])).toEqual(oldOutput);

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    const updated = remote.assistant("assistant_1")!;
    expect(updated.model.messages[0].content).toContain("A changed prompt.");
    expect(updated.model.toolIds).toEqual(["tool_5", "tool_6", "tool_7", "tool_8"]);
    expect(updated.model.toolIds.map(id => remote.tool(id)?.server.url)).toEqual(Array(4).fill(expect.stringMatching(/^https:\/\/changed\.example\.test\//)));
    expect(remote.output(updated.artifactPlan.structuredOutputIds[0])?.schema.properties).toHaveProperty("new_field");
    expect(remote.writes.tool.patch).toEqual([]);
    expect(remote.writes["structured-output"].patch).toEqual([]);
    expect((await currentSync()).appliedConfigHash).toBe(failed.desiredConfigHash);
  });

  it.each(["toolIds", "structuredOutputIds", "messages"] as const)("keeps the last published revision when Vapi retains stale %s", async field => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const published = await currentSync();
    const live = structuredClone(remote.assistant("assistant_1")!);
    env.APP_URL = "https://changed.example.test";
    await db.update(assistants).set({ systemPrompt: "Updated prompt.", structuredSchema: ["new_field"] })
      .where(and(eq(assistants.id, assistantId), eq(assistants.workspaceId, workspaceId)));
    server.use(http.patch(`${vapi}/assistant/assistant_1`, async ({ request }) => {
      const body = await request.json() as AssistantBody;
      if (field === "structuredOutputIds") body.artifactPlan.structuredOutputIds = live.artifactPlan.structuredOutputIds;
      else if (field === "toolIds") body.model.toolIds = live.model.toolIds;
      else body.model.messages = live.model.messages;
      const saved = { ...live, ...body };
      remote.resources.assistant.set(saved.id, saved);
      return HttpResponse.json(saved);
    }, { once: true }));

    expect(await syncAssistant(workspaceId, assistantId)).toMatchObject({
      ok: false, error: expect.stringContaining("did not confirm"),
    });
    const pending = await currentSync();
    expect(pending.desiredConfigHash).not.toBe(published.appliedConfigHash);
    expect(pending).toMatchObject({
      appliedConfigHash: published.appliedConfigHash,
      vapiToolIds: published.vapiToolIds,
      structuredOutputIds: published.structuredOutputIds,
      syncLeaseId: null,
    });
    if (field === "structuredOutputIds") {
      expect(remote.assistant("assistant_1")?.artifactPlan.structuredOutputIds).toEqual(live.artifactPlan.structuredOutputIds);
    } else {
      expect(remote.assistant("assistant_1")?.model[field]).toEqual(live.model[field]);
    }

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_1" });
    const recovered = await currentSync();
    const updated = remote.assistant("assistant_1")!;
    expect(recovered.appliedConfigHash).toBe(pending.desiredConfigHash);
    expect(recovered.vapiToolIds).toEqual(Object.fromEntries(
      updated.model.toolIds.map(id => [remote.tool(id)!.function.name, id]),
    ));
    expect(updated.model.messages[0].content).toContain("Updated prompt.");
    expect(updated.artifactPlan.structuredOutputIds).toEqual(recovered.structuredOutputIds);
    expect(remote.writes.assistant.create).toEqual(["assistant_1"]);
    expect(remote.writes.tool.create).toHaveLength(8);
    expect(remote.writes["structured-output"].create).toHaveLength(2);
  });

  it.each(["assistant_1", null])("checks and repairs the US phone binding after a missing assistant (%s)", async (binding) => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const number = await assignPhone(binding);
    remote.resources.assistant.delete("assistant_1");

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_2" });
    expect(number.assistantId).toBe("assistant_2");
    expect(remote.phoneReads).toEqual([number.id, number.id]);
    expect(remote.phoneWrites).toEqual(["assistant_2"]);
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_2", replacementVapiAssistantId: null });
    expect(await db.select().from(phoneNumbers).where(eq(phoneNumbers.workspaceId, workspaceId))).toMatchObject([
      { vapiPhoneNumberId: number.id, e164: number.number, assistantId },
    ]);
  });

  it("keeps the published mapping and leaves unexpected phone routing untouched", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const number = await assignPhone("another_workspace_assistant");
    remote.resources.assistant.delete("assistant_1");

    const result = await syncAssistant(workspaceId, assistantId);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("different routing") });
    expect(number.assistantId).toBe("another_workspace_assistant");
    expect(remote.phoneWrites).toEqual([]);
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_1", replacementVapiAssistantId: "assistant_2" });
    await expect(changePhoneNumber(workspaceId, {
      vapiPhoneNumberId: number.id, sourceWorkspaceId: null, operationId: crypto.randomUUID(),
    })).rejects.toThrow("Finish the assistant sync");

    number.assistantId = null;
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_2" });
    expect(remote.writes.assistant.create).toEqual(["assistant_1", "assistant_2"]);
    expect(remote.phoneWrites).toEqual(["assistant_2"]);
  });

  it("lets an existing phone operation settle before rebinding a replacement assistant", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const number = await assignPhone("assistant_1");
    const [assignment] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.workspaceId, workspaceId));
    const [change] = await db.insert(phoneNumberChanges).values({
      workspaceId, assistantId, vapiAssistantId: "assistant_1", vapiPhoneNumberId: number.id,
      phoneNumberId: assignment.id, status: "applying",
    }).returning();
    remote.resources.assistant.delete("assistant_1");

    expect(await syncAssistant(workspaceId, assistantId)).toMatchObject({ ok: false, error: expect.stringContaining("phone number change") });
    expect(remote.phoneReads).toEqual([]);
    expect(remote.phoneWrites).toEqual([]);
    await db.update(phoneNumberChanges).set({ status: "completed" }).where(eq(phoneNumberChanges.id, change.id));
    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_2" });
    expect(remote.writes.assistant.create).toEqual(["assistant_1", "assistant_2"]);
    expect(remote.phoneWrites).toEqual(["assistant_2"]);
  });

  it("recovers a lost phone patch response and authenticates calls from the staged replacement", async () => {
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(true);
    const number = await assignPhone("assistant_1");
    remote.resources.assistant.delete("assistant_1");
    remote.losePhoneResponse();
    expect((await syncAssistant(workspaceId, assistantId)).ok).toBe(false);
    expect(number.assistantId).toBe("assistant_2");
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_1", replacementVapiAssistantId: "assistant_2" });
    const request = new Request(`${appUrl}/api/vapi/tools`, {
      headers: { "x-vapi-secret": remote.assistant("assistant_2")!.server.headers["x-vapi-secret"] },
    });
    expect(await authenticateVapi(request, "assistant_2")).toMatchObject({ workspaceId });

    expect(await syncAssistant(workspaceId, assistantId)).toEqual({ ok: true, vapiAssistantId: "assistant_2" });
    expect(remote.phoneWrites).toEqual(["assistant_2"]);
    expect(remote.phoneReads).toEqual([number.id, number.id]);
    expect(await currentSync()).toMatchObject({ vapiAssistantId: "assistant_2", replacementVapiAssistantId: null, syncError: null });
  });
});
