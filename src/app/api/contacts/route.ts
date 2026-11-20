import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { errorResponse, fieldErrors, withAdmin, workspaceScope } from "@/lib/api";
import { upsertContact } from "@/lib/crm/contacts";
import { listContacts } from "@/lib/crm/list";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";

export const GET = withAdmin(async (_admin, request: Request) => {
  const workspaceId = workspaceScope(request);
  if (!workspaceId) return errorResponse(400, "workspaceId is required");
  const params = new URL(request.url).searchParams;
  return Response.json({ contacts: await listContacts(workspaceId, { q: params.get("q") ?? "", source: params.get("source") ?? "" }) });
});

const create = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional(),
  email: z.email().optional(),
});

export const POST = withAdmin(async (_admin, request: Request) => {
  const parsed = create.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid contact", fieldErrors(parsed.error));
  const { workspaceId, ...rest } = parsed.data;
  const result = await upsertContact({ workspaceId, ...rest, source: "form" });
  if (!result.ok) return errorResponse(422, "Invalid contact", { phone: "That phone number does not look right" });
  return Response.json({ id: result.id }, { status: 201 });
});

const edit = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  email: z.email().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});

export const PATCH = withAdmin(async (_admin, request: Request) => {
  const parsed = edit.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid contact", fieldErrors(parsed.error));
  const { workspaceId, id, ...changes } = parsed.data;
  if (!Object.keys(changes).length) return errorResponse(422, "Nothing to change");
  const [row] = await db
    .update(contacts)
    .set(changes)
    .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId)))
    .returning();
  return row ? Response.json({ contact: row }) : errorResponse(404, "Contact not found");
});
