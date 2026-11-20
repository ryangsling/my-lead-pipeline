import { and, eq, isNull } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { integrations } from "@/lib/db/schema";
import type { Fields, Provider } from "./providers";

export type Integration = {
  provider: Provider;
  workspaceId: string | null;
  creds: Fields;
  config: Fields;
  status: string;
  lastTestedAt: Date | null;
  lastError: string | null;
};

const scope = (provider: Provider, workspaceId: string | null) =>
  and(
    eq(integrations.provider, provider),
    workspaceId === null ? isNull(integrations.workspaceId) : eq(integrations.workspaceId, workspaceId),
  );

/** The row for exactly this scope (a workspace, or null for the global one). */
export async function getExactIntegration(provider: Provider, workspaceId: string | null): Promise<Integration | null> {
  const [row] = await db.select().from(integrations).where(scope(provider, workspaceId));
  if (!row) return null;
  return {
    provider,
    workspaceId: row.workspaceId,
    creds: row.credentialsEncrypted ? JSON.parse(decrypt(row.credentialsEncrypted)) : {},
    config: row.config as Fields,
    status: row.status,
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
  };
}

/** The workspace's own row if it has one, else the global row (I3). */
export async function getIntegration(provider: Provider, workspaceId: string): Promise<Integration | null> {
  return (await getExactIntegration(provider, workspaceId)) ?? getExactIntegration(provider, null);
}

/** Creates or replaces the row for this scope. A save resets the status to untested. */
export async function saveIntegration(provider: Provider, workspaceId: string | null, creds: Fields, config: Fields) {
  const values = {
    workspaceId,
    provider,
    credentialsEncrypted: Object.keys(creds).length ? encrypt(JSON.stringify(creds)) : null,
    config,
    status: "untested",
    lastTestedAt: null,
    lastError: null,
  };
  await db
    .insert(integrations)
    .values(values)
    .onConflictDoUpdate({ target: [integrations.workspaceId, integrations.provider], set: values });
}

export async function recordTest(
  provider: Provider,
  workspaceId: string | null,
  result: { ok: true } | { ok: false; error: string },
) {
  await db
    .update(integrations)
    .set({ status: result.ok ? "ok" : "failed", lastTestedAt: new Date(), lastError: result.ok ? null : result.error })
    .where(scope(provider, workspaceId));
}
