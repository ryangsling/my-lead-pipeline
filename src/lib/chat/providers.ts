import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { chatProviders } from "@/lib/db/schema";

const timeoutMs = z.number().int().min(100).max(30_000).default(8_000);
const baseUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}, "Use an HTTPS base URL without credentials, query, or fragment");

export const chatProviderInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  baseUrl: baseUrl.transform(url => new URL(url).href.replace(/\/+$/, "")),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(4_096).optional(),
  enabled: z.boolean(),
  toolCapable: z.boolean(),
  timeoutMs,
});
export const chatChainInput = z.array(chatProviderInput).max(5);
type ProviderInput = z.infer<typeof chatProviderInput>;
export type ChatProvider = typeof chatProviders.$inferSelect;
export type ChatProviderView = Pick<ChatProvider, "id" | "name" | "baseUrl" | "model" | "enabled" |
  "toolCapable" | "timeoutMs" | "position" | "cooldownUntil" | "testedAt" | "testPassed">;

const scope = (workspaceId: string | null) => workspaceId === null
  ? isNull(chatProviders.workspaceId) : eq(chatProviders.workspaceId, workspaceId);
const revision = (provider: ChatProvider) => and(scope(provider.workspaceId), eq(chatProviders.id, provider.id),
  eq(chatProviders.revision, provider.revision));

export function listChatProviders(workspaceId: string | null) {
  return db.select({
    id: chatProviders.id, name: chatProviders.name, baseUrl: chatProviders.baseUrl, model: chatProviders.model,
    enabled: chatProviders.enabled, toolCapable: chatProviders.toolCapable, timeoutMs: chatProviders.timeoutMs,
    position: chatProviders.position, cooldownUntil: chatProviders.cooldownUntil,
    testedAt: chatProviders.testedAt, testPassed: chatProviders.testPassed,
  }).from(chatProviders).where(scope(workspaceId)).orderBy(asc(chatProviders.position));
}

/** An explicit workspace chain replaces the global chain, including if all its providers are disabled. */
export async function resolveChatProviders(workspaceId: string) {
  const local = await db.select().from(chatProviders).where(scope(workspaceId)).orderBy(asc(chatProviders.position));
  const chain = local.length ? local : await db.select().from(chatProviders).where(scope(null)).orderBy(asc(chatProviders.position));
  return chain.filter(provider => provider.enabled && provider.toolCapable);
}

export async function saveChatProviders(workspaceId: string | null, chain: ProviderInput[]) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId ?? "global-chat-providers"}, 471))`);
    const current = await tx.select().from(chatProviders).where(scope(workspaceId)).for("update");
    const ids = new Set<string>();
    const rows: (typeof chatProviders.$inferInsert)[] = [];
    for (const [position, { id, apiKey, ...input }] of chain.entries()) {
      const saved = current.find(provider => provider.id === id);
      if ((id && (!saved || ids.has(id))) || (!apiKey && !saved)) return false;
      if (id) ids.add(id);
      const changed = !saved || apiKey !== undefined || input.baseUrl !== saved.baseUrl || input.model !== saved.model;
      rows.push({
        ...input, workspaceId, position, id: saved?.id,
        apiKeyEncrypted: apiKey ? encrypt(apiKey) : saved!.apiKeyEncrypted,
        ...(!changed && saved ? {
          revision: saved.revision, cooldownUntil: saved.cooldownUntil, testedAt: saved.testedAt, testPassed: saved.testPassed,
        } : {}),
      });
    }
    await tx.delete(chatProviders).where(scope(workspaceId));
    if (rows.length) await tx.insert(chatProviders).values(rows);
    return true;
  });
}

export async function getChatProvider(workspaceId: string | null, id: string) {
  const [provider] = await db.select().from(chatProviders).where(and(scope(workspaceId), eq(chatProviders.id, id)));
  return provider;
}

export async function putInCooldown(provider: ChatProvider, until: Date) {
  await db.update(chatProviders).set({ cooldownUntil: sql`greatest(${chatProviders.cooldownUntil}, ${until.toISOString()}::timestamptz)` })
    .where(revision(provider));
}

export async function recordChatProviderTest(provider: ChatProvider, passed: boolean) {
  await db.update(chatProviders).set({ testedAt: new Date(), testPassed: passed }).where(revision(provider));
}

export const chatProviderKey = (provider: ChatProvider) => decrypt(provider.apiKeyEncrypted);
