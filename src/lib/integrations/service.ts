import { z } from "zod";
import { mask } from "@/lib/crypto";
import { type Fields, type Provider, providers } from "./providers";
import { getExactIntegration, type Integration, saveIntegration } from "./store";

const isMasked = (v: string) => v === "" || v.startsWith("****");

const fieldsOf = (keys: readonly string[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.string().max(2000).optional()]))).strict();

export type PutInput = { credentials?: Record<string, string | undefined>; config?: Record<string, string | undefined> };

export function putSchema(provider: Provider): z.ZodType<PutInput> {
  const p = providers[provider];
  return z.object({ credentials: fieldsOf(p.secrets).optional(), config: fieldsOf(p.config).optional() });
}

/** What the browser may see: secrets masked, config as stored. */
export function toView(provider: Provider, row: Integration | null) {
  const credentials = Object.fromEntries(providers[provider].secrets.map((k) => [k, row?.creds[k] ? mask(row.creds[k]) : ""]));
  return {
    provider,
    saved: row !== null,
    credentials,
    config: row?.config ?? {},
    status: row?.status ?? "untested",
    lastTestedAt: row?.lastTestedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

/** Saves the form. A blank or masked secret keeps the stored one. */
export async function updateIntegration(
  provider: Provider,
  workspaceId: string | null,
  input: PutInput,
) {
  const existing = await getExactIntegration(provider, workspaceId);
  const creds: Fields = { ...existing?.creds };
  for (const [k, v] of Object.entries(input.credentials ?? {})) {
    if (v !== undefined && !isMasked(v)) creds[k] = v;
  }
  const config: Fields = { ...existing?.config };
  for (const [k, v] of Object.entries(input.config ?? {})) {
    if (v !== undefined) config[k] = v;
  }
  await saveIntegration(provider, workspaceId, creds, config);
  return toView(provider, await getExactIntegration(provider, workspaceId));
}
