import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { renderPrompt } from "@/lib/agent/prompt";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, services, workspaces, type SyncResourceCheckpoint } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { resolveVapiAccount } from "./account";
import { assistantRecordingConfig, buildAssistantConfig, unrecordedNotice } from "./assistant-config";
import { VapiError, vapiFetch } from "./client";
import { PhoneNumberError, rebindAssistantPhone } from "./phone-numbers";
import { recordingApproved } from "./recording";
import { buildStructuredSchema, readStructuredFields } from "./structured";
import { ensureRemoteResource, isMissing, readResourceId, resourcePath, SyncConfirmationError } from "./sync-resource";
import { buildToolBody, toolDefinitions } from "./tools";

export type SyncResult = { ok: true; vapiAssistantId: string } | { ok: false; error: string };

// Each invocation stops sending remote requests before another worker can take over its lease.
const SYNC_TIMEOUT_MS = 35_000;
const SYNC_LEASE_MS = 60_000;
const busy = "An assistant sync is already running. Retry after it finishes.";
const genericError = "Vapi sync failed. Check the account and voice settings.";
const resourceMarker = "incodetSyncCreate";

type SyncRow = typeof assistantSyncs.$inferSelect;

function configHash(body: unknown) {
  const json = JSON.stringify(body, (_, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : value);
  return createHash("sha256").update(json).digest("hex");
}

async function desiredConfig(assistantId: string, workspaceId: string) {
  const { assistant, workspace, workspaceServices } = await db.transaction(async tx => {
    const assistant = await tx.query.assistants.findFirst({ where: and(
      eq(assistants.id, assistantId), eq(assistants.workspaceId, workspaceId),
    ) });
    if (!assistant) throw new SyncConfirmationError("Assistant not found");
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!workspace) throw new SyncConfirmationError("Workspace not found");
    const workspaceServices = await tx.select().from(services).where(eq(services.workspaceId, workspaceId))
      .orderBy(asc(services.name), asc(services.id));
    return { assistant, workspace, workspaceServices };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const secret = decrypt(workspace.webhookSecretEncrypted);
  const server = {
    url: `${env.APP_URL.replace(/\/+$/, "")}/api/vapi/tools`,
    headers: { "x-vapi-secret": secret },
  };
  const tools = toolDefinitions.map(definition => buildToolBody(definition, server));
  const output = {
    name: `${workspace.name} call fields`,
    type: "ai",
    schema: buildStructuredSchema([...new Set([...readStructuredFields(assistant.structuredSchema), "disposition"])]),
  };
  const coveragePrompt = (workspace.serviceZips.length || workspace.serviceCities.length
    ? "\nAsk for the site ZIP and city before offering any times. If the site is outside our service area, offer to save the caller's details."
    : "") + (workspaceServices.some((service) => service.active && service.visitKind === "estimate")
    ? "\nConfirm an estimate visit as an estimate and collect the job site address and ZIP. Do not promise a price or completed work."
    : "");
  const intakePrompt = "\nAsk about the problem, site, referral source and callback window when relevant. Use only listed prices. If the caller is outside the service area, offer to save a callback lead.";
  const urgentPrompt = [
    "For gas smell, fire or flooding near electrics, first tell the caller to get to safety and call 911 immediately. Give that advice before intake.",
    "For urgent contractor help, collect the caller name, callback number and problem, then call notify_urgent. Follow its result before confirming an alert.",
    workspace.escalationTriggers && `Business escalation triggers: ${workspace.escalationTriggers}`,
    workspace.transferEnabled && "After an urgent alert is accepted, offer a live transfer. If the connection is unavailable or unanswered, rely on the callback already requested. Do not try repeated transfers.",
  ].filter(Boolean).join("\n");
  const draft = {
    ...assistant,
    businessName: workspace.name,
    recordingEnabled: workspace.recordingEnabled && recordingApproved(workspaceId),
    systemPrompt: renderPrompt(assistant.systemPrompt, workspace, workspaceServices) + coveragePrompt + intakePrompt + "\n" + urgentPrompt,
  };
  return { tools, output, draft, secret, transferEnabled: workspace.transferEnabled };
}

type Desired = Awaited<ReturnType<typeof desiredConfig>>;
type AssistantBody = ReturnType<typeof buildAssistantConfig>;
type RecordingConfig = ReturnType<typeof assistantRecordingConfig>;
type VapiContext = { privateKey: string; signal: AbortSignal };
type RemoteAssistant = {
  firstMessage?: string;
  firstMessageMode?: string;
  firstMessageInterruptionsEnabled?: boolean;
  model?: Partial<Pick<AssistantBody["model"], "messages" | "toolIds">>;
  artifactPlan?: Partial<AssistantBody["artifactPlan"]> & Record<string, unknown>;
  monitorPlan?: Partial<RecordingConfig["monitorPlan"]>;
  compliancePlan?: RecordingConfig["compliancePlan"] & Record<string, unknown>;
};

async function readRemoteAssistant(context: VapiContext, id: string) {
  const remote = await vapiFetch<RemoteAssistant>(context.privateKey, resourcePath("/assistant", id), { signal: context.signal });
  readResourceId(remote, id);
  return remote;
}

function hasRecordingConfig(remote: RemoteAssistant, config: RecordingConfig) {
  const actual = remote.compliancePlan?.recordingConsentPlan;
  const expected = config.compliancePlan.recordingConsentPlan;
  const consent = expected ? actual?.type === expected.type && actual.firstMessageMode === expected.firstMessageMode &&
    actual.message === expected.message && actual.declineTool?.type === expected.declineTool.type &&
    Array.isArray(actual.declineTool.messages) && actual.declineTool.messages.some((message) => message?.type === "request-start" && message.blocking === true &&
      message.content === expected.declineTool.messages[0].content) : !actual;
  return consent && remote.artifactPlan?.recordingEnabled === config.artifactPlan.recordingEnabled &&
    remote.artifactPlan.pcapEnabled === false && remote.artifactPlan.videoRecordingEnabled === false &&
    remote.monitorPlan?.listenEnabled === false && remote.monitorPlan.controlEnabled === false &&
    remote.firstMessageMode === config.firstMessageMode && remote.firstMessageInterruptionsEnabled === false;
}

function matchesResourceIds(actual: unknown, expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every(id => actual.includes(id));
}

function hasExpectedPromptAndResources(remote: RemoteAssistant, config: AssistantBody) {
  const messages = remote.model?.messages;
  return matchesResourceIds(remote.model?.toolIds, config.model.toolIds) &&
    matchesResourceIds(remote.artifactPlan?.structuredOutputIds, config.artifactPlan.structuredOutputIds) &&
    Array.isArray(messages) && messages.length === config.model.messages.length &&
    config.model.messages.every((message, index) =>
      messages[index]?.role === message.role && messages[index]?.content === message.content);
}

function remoteCompliance(remote: RemoteAssistant, config: RecordingConfig) {
  const compliance = { ...remote.compliancePlan, ...config.compliancePlan };
  if (!config.compliancePlan.recordingConsentPlan) delete compliance.recordingConsentPlan;
  return compliance;
}

async function applyUnrecorded(context: VapiContext, id: string, remote: RemoteAssistant, fallback: RecordingConfig) {
  await vapiFetch(context.privateKey, resourcePath("/assistant", id), {
    method: "PATCH", signal: context.signal, body: {
      ...fallback,
      artifactPlan: { ...remote.artifactPlan, ...fallback.artifactPlan },
      compliancePlan: remoteCompliance(remote, fallback),
    },
  });
  const confirmed = await readRemoteAssistant(context, id);
  if (!hasRecordingConfig(confirmed, fallback) || confirmed.firstMessage !== fallback.firstMessage) {
    throw new SyncConfirmationError("Vapi did not confirm that recording is disabled. Pause calls and check the assistant in Vapi.");
  }
}

/** Make any legacy or mismatched live configuration unrecorded before staging ordinary resources. */
async function protectExistingAssistants(row: SyncRow, context: VapiContext, expected: RecordingConfig, fallback: RecordingConfig) {
  const known = new Set([row.vapiAssistantId, row.replacementVapiAssistantId, row.resourceCheckpoints.assistant?.remoteId]);
  for (const id of known) {
    if (!id) continue;
    const remote = await readRemoteAssistant(context, id).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    if (!remote) continue;
    const expectedLine = expected.firstMessage.split("\n")[0];
    const liveLine = remote.firstMessage?.split("\n")[0];
    if (expected.artifactPlan.recordingEnabled && liveLine === expectedLine && hasRecordingConfig(remote, expected)) continue;
    if (remote.firstMessage?.includes(unrecordedNotice) && hasRecordingConfig(remote, fallback)) continue;
    await applyUnrecorded(context, id, remote, fallback);
  }
}

async function acquireLease(workspaceId: string, assistantId: string, vapiAccountId: string | null) {
  const syncLeaseId = randomUUID();
  const lease = { syncLeaseId, syncLeaseUntil: sql`clock_timestamp() + ${SYNC_LEASE_MS} * interval '1 millisecond'` };
  const [row] = await db.insert(assistantSyncs).values({ workspaceId, assistantId, vapiAccountId, ...lease }).onConflictDoUpdate({
    target: [assistantSyncs.workspaceId, assistantSyncs.assistantId, assistantSyncs.vapiAccountId],
    set: lease,
    setWhere: or(isNull(assistantSyncs.syncLeaseUntil), sql`${assistantSyncs.syncLeaseUntil} <= clock_timestamp()`),
  }).returning();
  return row;
}

function leaseScope(row: SyncRow) {
  return and(eq(assistantSyncs.workspaceId, row.workspaceId), eq(assistantSyncs.id, row.id), eq(assistantSyncs.syncLeaseId, row.syncLeaseId!),
    sql`${assistantSyncs.syncLeaseUntil} > clock_timestamp()`);
}

async function saveSync(row: SyncRow, values: Partial<typeof assistantSyncs.$inferInsert>, executor: Pick<typeof db, "update"> = db) {
  const [saved] = await executor.update(assistantSyncs).set(values).where(leaseScope(row)).returning({ id: assistantSyncs.id });
  if (!saved) throw new SyncConfirmationError("Assistant sync expired. Retry sync to continue.");
}

function resourceCheckpoint(row: SyncRow, key: string) {
  return async (checkpoint: SyncResourceCheckpoint | null) => {
    if (checkpoint) row.resourceCheckpoints[key] = checkpoint;
    else delete row.resourceCheckpoints[key];
    await saveSync(row, { resourceCheckpoints: row.resourceCheckpoints });
  };
}

async function syncDependencies(row: SyncRow, context: { privateKey: string; signal: AbortSignal }, desired: Desired) {
  const toolIds: Record<string, string> = {};
  for (const body of desired.tools) {
    const name = body.function.name;
    const key = `tool/${name}/${configHash(body)}`;
    const tool = await ensureRemoteResource(context, {
      path: "/tool",
      body: marker => ({ ...body, server: { ...body.server, url: `${body.server.url}?${resourceMarker}=${marker}` } }),
      matches: (item, marker) => item.server?.url?.endsWith(`?${resourceMarker}=${marker}`) === true,
    }, row.resourceCheckpoints[key], resourceCheckpoint(row, key));
    toolIds[name] = tool.id;
  }

  const outputKey = `structured-output/${configHash(desired.output)}`;
  const description = (marker: string) => `Incodet sync: ${marker}`;
  const output = await ensureRemoteResource(context, {
    path: "/structured-output",
    name: desired.output.name,
    body: marker => ({ ...desired.output, description: description(marker) }),
    matches: (item, marker) => item.description === description(marker),
  }, row.resourceCheckpoints[outputKey], resourceCheckpoint(row, outputKey));
  return { toolIds, structuredOutputIds: [output.id] };
}

async function syncRemoteAssistant(row: SyncRow, context: VapiContext, body: AssistantBody) {
  const update = async (id: string) => {
    const remote = await readRemoteAssistant(context, id);
    const response = await vapiFetch(context.privateKey, resourcePath("/assistant", id), {
      method: "PATCH", signal: context.signal, body: {
        ...body,
        compliancePlan: remoteCompliance(remote, body),
        model: { ...body.model, tools: body.model.tools ?? [] },
      },
    });
    return readResourceId(response, id);
  };
  const key = "assistant";
  const save = resourceCheckpoint(row, key);
  const checkpoint = row.resourceCheckpoints[key];
  const existing = checkpoint ? checkpoint.remoteId : row.vapiAssistantId;
  if (existing) {
    try {
      return await update(existing);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const confirmed = await ensureRemoteResource(context, {
    path: "/assistant",
    body: marker => ({ ...body, metadata: { [resourceMarker]: marker } }),
    matches: (item, marker) => item.metadata?.[resourceMarker] === marker,
  }, existing ? undefined : checkpoint, save);
  // A recovered create can belong to a draft that was edited after the first attempt.
  return confirmed.created ? confirmed.id : update(confirmed.id);
}

/** Publishes one complete set of versioned Vapi resources for this assistant and account. */
export async function syncAssistant(workspaceId: string, assistantId: string): Promise<SyncResult> {
  const [assistant] = await db.select({ id: assistants.id }).from(assistants)
    .where(and(eq(assistants.workspaceId, workspaceId), eq(assistants.id, assistantId)));
  if (!assistant) return { ok: false, error: "Assistant not found" };

  let row: SyncRow | undefined;
  try {
    const account = await resolveVapiAccount(workspaceId);
    const signal = AbortSignal.timeout(SYNC_TIMEOUT_MS);
    row = await acquireLease(workspaceId, assistantId, account.accountId);
    if (!row) return { ok: false, error: busy };
    signal.throwIfAborted();
    const leased = row;
    const desired = await desiredConfig(assistantId, workspaceId);
    const context = { privateKey: account.privateKey, signal };
    const expected = assistantRecordingConfig(desired.draft);
    const fallback = assistantRecordingConfig({ ...desired.draft, recordingEnabled: false });
    await protectExistingAssistants(leased, context, expected, fallback);
    const assistantBody = buildAssistantConfig(desired.draft, [], [], desired.secret, desired.transferEnabled);
    const hash = configHash({ tools: desired.tools, output: desired.output, assistant: assistantBody });
    await saveSync(leased, { desiredConfigHash: hash });

    const { toolIds, structuredOutputIds } = await syncDependencies(leased, context, desired);
    const config: AssistantBody = {
      ...assistantBody,
      model: { ...assistantBody.model, toolIds: Object.values(toolIds) },
      artifactPlan: { ...assistantBody.artifactPlan, structuredOutputIds },
    };
    const vapiAssistantId = await syncRemoteAssistant(leased, context, config);
    const remote = await readRemoteAssistant(context, vapiAssistantId);
    if (!hasRecordingConfig(remote, expected) || remote.firstMessage !== expected.firstMessage) {
      await applyUnrecorded(context, vapiAssistantId, remote, fallback);
      throw new SyncConfirmationError("Vapi did not confirm the requested call recording policy. The assistant was set to unrecorded.");
    }
    if (!hasExpectedPromptAndResources(remote, config)) {
      throw new SyncConfirmationError("Vapi did not confirm the assistant's prompt, tools, or structured outputs. Retry sync to check Vapi again.");
    }
    const published = {
      vapiAssistantId, vapiToolIds: toolIds, structuredOutputIds, appliedConfigHash: hash,
      replacementVapiAssistantId: null, syncedAt: new Date(), syncError: null,
    };
    const previousId = leased.vapiAssistantId;
    if (previousId && previousId !== vapiAssistantId) {
      // Recognize the ready replacement's webhooks before a phone can start sending calls to it.
      await saveSync(leased, { replacementVapiAssistantId: vapiAssistantId });
      await db.transaction(async tx => {
        const [owned] = await tx.select({ id: assistantSyncs.id }).from(assistantSyncs).where(leaseScope(leased)).for("update");
        if (!owned) throw new SyncConfirmationError("Assistant sync expired. Retry sync to continue.");
        await rebindAssistantPhone(tx, {
          workspaceId, assistantId, account, previousId, replacementId: vapiAssistantId, signal,
        });
        await saveSync(leased, published, tx);
      });
    } else {
      await saveSync(leased, published);
    }
    return { ok: true, vapiAssistantId };
  } catch (error) {
    const message = error instanceof VapiError || error instanceof PhoneNumberError || error instanceof SyncConfirmationError
      ? error.message : genericError;
    if (row) await saveSync(row, { syncError: message }).catch(() => {});
    return { ok: false, error: message };
  } finally {
    if (row) await saveSync(row, { syncLeaseId: null, syncLeaseUntil: null }).catch(() => {});
  }
}
