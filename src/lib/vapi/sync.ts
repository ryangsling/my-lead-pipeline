import { and, eq, isNull } from "drizzle-orm";
import { renderPrompt } from "@/lib/agent/prompt";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getWorkspace } from "@/lib/workspaces";
import { resolveVapiAccount, type VapiAccount } from "./account";
import { buildAssistantConfig } from "./assistant-config";
import { VapiError, vapiFetch } from "./client";
import { buildStructuredSchema, readStructuredFields } from "./structured";
import { buildToolBody, toolDefinitions } from "./tools";

export type SyncResult = { ok: true; vapiAssistantId: string } | { ok: false; error: string };
type ToolIds = Record<string, string>;

function readToolIds(raw: unknown): ToolIds {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readStructuredOutputIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

async function createOrUpdate<T extends { id: string }>(
  account: VapiAccount,
  path: string,
  id: string | undefined,
  body: unknown,
): Promise<T> {
  if (id) {
    try {
      return await vapiFetch<T>(account.privateKey, `${path}/${id}`, { method: "PATCH", body });
    } catch (error) {
      if (!(error instanceof VapiError) || error.status !== 404) throw error;
    }
  }
  return vapiFetch<T>(account.privateKey, path, { method: "POST", body });
}

async function syncTools(account: VapiAccount, existing: ToolIds, server: { url: string; headers: Record<string, string> }) {
  const ids: ToolIds = {};
  for (const definition of toolDefinitions) {
    const body = buildToolBody(definition, server);
    const tool = await createOrUpdate<{ id: string }>(account, "/tool", existing[definition.name], body);
    ids[definition.name] = tool.id;
  }
  return ids;
}

async function syncStructuredOutput(account: VapiAccount, existingId: string | undefined, name: string, fields: string[]) {
  const body = { name, type: "ai", schema: buildStructuredSchema(fields) };
  const output = await createOrUpdate<{ id: string }>(account, "/structured-output", existingId, body);
  return [output.id];
}

async function saveSync(assistantId: string, values: Partial<typeof assistantSyncs.$inferInsert>) {
  await db
    .insert(assistantSyncs)
    .values({ assistantId, vapiAccountId: null, ...values })
    .onConflictDoUpdate({
      target: [assistantSyncs.assistantId, assistantSyncs.vapiAccountId],
      set: values,
    });
}

/** Creates or updates the tools, structured output and Vapi assistant for one assistant (A2). */
export async function syncAssistant(assistantId: string): Promise<SyncResult> {
  const assistant = await db.query.assistants.findFirst({ where: eq(assistants.id, assistantId) });
  if (!assistant) return { ok: false, error: "Assistant not found" };

  const workspace = await getWorkspace(assistant.workspaceId);
  const [secretRow] = await db
    .select({ secret: workspaces.webhookSecretEncrypted })
    .from(workspaces)
    .where(eq(workspaces.id, assistant.workspaceId));
  if (!workspace || !secretRow) return { ok: false, error: "Workspace not found" };

  const [existing] = await db
    .select()
    .from(assistantSyncs)
    .where(and(eq(assistantSyncs.assistantId, assistantId), isNull(assistantSyncs.vapiAccountId)));

  try {
    const account = await resolveVapiAccount(assistant.workspaceId);
    const secret = decrypt(secretRow.secret);
    const server = {
      url: `${env.APP_URL.replace(/\/+$/, "")}/api/vapi/tools`,
      headers: { "x-vapi-secret": secret },
    };
    const workspaceServices = await db.select().from(services).where(eq(services.workspaceId, assistant.workspaceId));
    const toolIds = await syncTools(account, readToolIds(existing?.vapiToolIds), server);
    const structuredOutputIds = await syncStructuredOutput(
      account,
      readStructuredOutputIds(existing?.structuredOutputIds)[0],
      `${workspace.name} call fields`,
      readStructuredFields(assistant.structuredSchema),
    );
    const config = buildAssistantConfig(
      { ...assistant, businessName: workspace.name, recordingEnabled: workspace.recordingEnabled, systemPrompt: renderPrompt(assistant.systemPrompt, workspace, workspaceServices) },
      Object.values(toolIds),
      structuredOutputIds,
      secret,
      workspace.transferEnabled,
    );
    const remote = await createOrUpdate<{ id: string }>(
      account,
      "/assistant",
      existing?.vapiAssistantId ?? undefined,
      config,
    );

    await saveSync(assistantId, {
      vapiAssistantId: remote.id,
      vapiToolIds: toolIds,
      structuredOutputIds,
      syncedAt: new Date(),
      syncError: null,
    });
    return { ok: true, vapiAssistantId: remote.id };
  } catch (error) {
    const message = error instanceof VapiError ? error.message : "Vapi sync failed. Check the account and voice settings.";
    await saveSync(assistantId, { syncError: message });
    return { ok: false, error: message };
  }
}
