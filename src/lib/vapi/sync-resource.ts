import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SyncResourceCheckpoint } from "@/lib/db/schema";
import { VapiError, vapiFetch } from "./client";

type ResourcePath = "/assistant" | "/tool" | "/structured-output";
type RemoteResource = z.infer<typeof resourceSchema>;

const idSchema = z.object({ id: z.string().min(1).max(128) });
const resourceSchema = idSchema.extend({
  createdAt: z.iso.datetime({ offset: true }).optional(),
  server: z.object({ url: z.string().nullish() }).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  description: z.string().nullish(),
});
const structuredListSchema = z.object({
  results: resourceSchema.array(),
  metadata: z.object({
    hasNextPage: z.boolean().optional(),
    totalPages: z.number().int().optional(),
    totalItems: z.number().int(),
    itemsPerPage: z.number().int().positive(),
  }),
});

export class SyncConfirmationError extends Error {}

export function isMissing(error: unknown) {
  return error instanceof VapiError && error.status === 404;
}

function definitivelyRejected(error: unknown) {
  return error instanceof VapiError && error.status >= 400 && error.status < 500 &&
    ![408, 409, 425, 429].includes(error.status);
}

export function resourcePath(path: ResourcePath, id: string) {
  return `${path}/${encodeURIComponent(id)}`;
}

export function readResourceId(value: unknown, expectedId?: string) {
  const { id } = idSchema.parse(value);
  if (expectedId && id !== expectedId) throw new Error("Unexpected Vapi resource ID");
  return id;
}

type Resource = {
  path: ResourcePath;
  name?: string;
  body: (marker: string) => unknown;
  matches: (resource: RemoteResource, marker: string) => boolean;
};

type ResourceContext = { privateKey: string; signal: AbortSignal };

async function findCreatedResource(
  { privateKey, signal }: ResourceContext,
  resource: Resource,
  checkpoint: SyncResourceCheckpoint,
) {
  const limit = 100;
  // Include a clock skew allowance when narrowing the provider's inventory.
  const since = new Date(Date.parse(checkpoint.startedAt) - 5 * 60_000).toISOString();
  const query = new URLSearchParams({ limit: String(limit), createdAtGe: since });
  const find = (items: RemoteResource[]) => {
    const matches = items.filter(item => resource.matches(item, checkpoint.marker));
    if (matches.length > 1) throw new SyncConfirmationError("Vapi returned multiple resources for a sync attempt. Review them before retrying.");
    return matches[0]?.id;
  };

  if (resource.path === "/structured-output") {
    if (resource.name) query.set("name", resource.name);
    for (let page = 1; ; page++) {
      query.set("page", String(page));
      const response = await vapiFetch(privateKey, `${resource.path}?${query}`, { signal });
      const { results, metadata } = structuredListSchema.parse(response);
      const match = find(results);
      if (match) return match;
      const pages = metadata.totalPages ?? Math.ceil(metadata.totalItems / metadata.itemsPerPage);
      if (!(metadata.hasNextPage ?? page < pages)) return null;
    }
  }

  // Assistants and tools use creation timestamps for pagination.
  for (;;) {
    const response = await vapiFetch(privateKey, `${resource.path}?${query}`, { signal });
    const items = resourceSchema.array().parse(response);
    const match = find(items);
    if (match) return match;
    if (items.length < limit) return null;
    const oldest = items.at(-1)?.createdAt;
    if (!oldest || oldest === query.get("createdAtLt")) return null;
    query.set("createdAtLt", oldest);
  }
}

/** Checkpoint intent before POST and the remote ID as soon as it is available. */
export async function ensureRemoteResource(
  context: ResourceContext,
  resource: Resource,
  checkpoint: SyncResourceCheckpoint | undefined,
  save: (checkpoint: SyncResourceCheckpoint | null) => Promise<void>,
) {
  const { privateKey, signal } = context;
  if (checkpoint?.remoteId) {
    try {
      const response = await vapiFetch(privateKey, resourcePath(resource.path, checkpoint.remoteId), { signal });
      return { id: readResourceId(response, checkpoint.remoteId), created: false };
    } catch (error) {
      if (!isMissing(error)) throw error;
      checkpoint = undefined;
    }
  }
  if (checkpoint) {
    const id = await findCreatedResource(context, resource, checkpoint);
    if (!id) {
      throw new SyncConfirmationError(`Vapi ${resource.path.slice(1)} creation is awaiting confirmation. Retry sync to check Vapi again.`);
    }
    await save({ ...checkpoint, remoteId: id });
    return { id, created: false };
  }

  signal.throwIfAborted();
  const intent = { marker: randomUUID(), startedAt: new Date().toISOString(), remoteId: null };
  await save(intent);
  if (signal.aborted) {
    await save(null);
    signal.throwIfAborted();
  }
  let id: string;
  try {
    const response = await vapiFetch(privateKey, resource.path, {
      method: "POST", body: resource.body(intent.marker), signal,
    });
    id = readResourceId(response);
  } catch (error) {
    if (definitivelyRejected(error)) await save(null);
    throw error;
  }
  await save({ ...intent, remoteId: id });
  return { id, created: true };
}
