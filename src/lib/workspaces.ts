import { randomBytes } from "node:crypto";
import { and, asc, eq, getTableColumns, ne } from "drizzle-orm";
import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

/** Every column except the encrypted webhook secret, which never leaves the server. */
const { webhookSecretEncrypted, ...publicColumns } = getTableColumns(workspaces);
void webhookSecretEncrypted;

export const workspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens"),
  niche: z.string().trim().max(60),
  country: z
    .string()
    .length(2, "Use a 2-letter country code")
    .transform((s) => s.toUpperCase()),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown timezone"),
  phoneDisplay: z.string().trim().max(40),
  transferEnabled: z.boolean().optional(),
  callbackMinutes: z.number().int().min(1).max(120).optional(),
  onCallNumber: z.string().trim().regex(/^(?:\+[1-9]\d{7,14})?$/).optional(),
  backupNumber: z.string().trim().regex(/^(?:\+[1-9]\d{7,14})?$/).optional(),
  escalationTriggers: z.string().trim().max(1000).optional(),
  serviceZips: z.array(z.string().trim().regex(/^\d{5}$/)).max(300).optional(),
  serviceCities: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  recordingEnabled: z.boolean().optional(),
  vapiMode: z.enum(["pool", "own"]),
  businessInfo: z.object({
    hours: z.string().max(2000),
    address: z.string().max(500),
    serviceArea: z.string().max(500),
    faq: z.string().max(10000),
    policies: z.string().max(5000),
  }),
});
export const workspacePatch = workspaceInput.partial();

export type WorkspaceInput = z.infer<typeof workspaceInput>;
export type WorkspaceView = Omit<typeof workspaces.$inferSelect, "webhookSecretEncrypted">;
type Result = { workspace: WorkspaceView } | { fields: Record<string, string> };

/** Business info as the form needs it, tolerant of older stored shapes. */
export function readBusinessInfo(raw: unknown): WorkspaceInput["businessInfo"] {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return { hours: s("hours"), address: s("address"), serviceArea: s("serviceArea"), faq: s("faq"), policies: s("policies") };
}

function toRow(input: Partial<WorkspaceInput>) {
  const { niche, phoneDisplay, ...rest } = input;
  return {
    ...rest,
    ...(niche !== undefined && { niche: niche || null }),
    ...(phoneDisplay !== undefined && { phoneDisplay: phoneDisplay || null }),
  };
}

async function slugTaken(slug: string, exceptId?: string) {
  const where = exceptId ? and(eq(workspaces.slug, slug), ne(workspaces.id, exceptId)) : eq(workspaces.slug, slug);
  const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(where);
  return Boolean(row);
}

const SLUG_TAKEN = { slug: "This slug is already used" };

export async function listWorkspaces(): Promise<WorkspaceView[]> {
  return db.select(publicColumns).from(workspaces).where(eq(workspaces.status, "active")).orderBy(asc(workspaces.name));
}

export async function getWorkspace(id: string): Promise<WorkspaceView | undefined> {
  const [row] = await db.select(publicColumns).from(workspaces).where(eq(workspaces.id, id));
  return row;
}

export async function getWorkspaceBySlug(slug: string): Promise<WorkspaceView | undefined> {
  const [row] = await db.select(publicColumns).from(workspaces).where(eq(workspaces.slug, slug));
  return row;
}

export async function createWorkspace(input: WorkspaceInput): Promise<Result> {
  if (await slugTaken(input.slug)) return { fields: SLUG_TAKEN };
  const [row] = await db
    .insert(workspaces)
    .values({
      ...input,
      niche: input.niche || null,
      phoneDisplay: input.phoneDisplay || null,
      webhookSecretEncrypted: encrypt(randomBytes(32).toString("hex")),
    })
    .returning(publicColumns);
  return { workspace: row };
}

export async function updateWorkspace(id: string, patch: Partial<WorkspaceInput>): Promise<Result | undefined> {
  if (patch.slug && (await slugTaken(patch.slug, id))) return { fields: SLUG_TAKEN };
  const [row] = await db.update(workspaces).set(toRow(patch)).where(eq(workspaces.id, id)).returning(publicColumns);
  return row && { workspace: row };
}

export async function archiveWorkspace(id: string): Promise<WorkspaceView | undefined> {
  const [row] = await db.update(workspaces).set({ status: "archived" }).where(eq(workspaces.id, id)).returning(publicColumns);
  return row;
}
