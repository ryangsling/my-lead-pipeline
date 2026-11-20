import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getAssistant } from "@/lib/agent/store";
import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { db } from "@/lib/db/client";
import { assistantSyncs, phoneNumbers } from "@/lib/db/schema";
import { resolveVapiAccount } from "@/lib/vapi/account";
import { vapiFetch } from "@/lib/vapi/client";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/phone-numbers">;
type VapiNumber = { id: string; number: string; assistantId?: string };

const assignInput = z.object({ vapiPhoneNumberId: z.string().min(1), e164: z.string().min(1) });

const notFound = () => errorResponse(404, "Workspace not found");

export const GET = withAdmin(async (_admin, _request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return notFound();
  try {
    const account = await resolveVapiAccount(id);
    const numbers = await vapiFetch<VapiNumber[]>(account.privateKey, "/phone-number");
    const [assigned] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.workspaceId, id));
    return Response.json({
      numbers: numbers.map((n) => ({ id: n.id, number: n.number })),
      assigned: assigned ? { id: assigned.vapiPhoneNumberId, number: assigned.e164 } : null,
    });
  } catch (error) {
    return errorResponse(422, error instanceof Error ? error.message : "Could not list phone numbers");
  }
});

export const POST = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return notFound();
  const parsed = assignInput.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid phone number", fieldErrors(parsed.error));

  const assistant = await getAssistant(id);
  const [sync] = assistant
    ? await db
        .select()
        .from(assistantSyncs)
        .where(and(eq(assistantSyncs.assistantId, assistant.id), isNull(assistantSyncs.vapiAccountId)))
    : [];
  if (!assistant || !sync?.vapiAssistantId) return errorResponse(422, "Sync the agent before assigning a number");

  try {
    const account = await resolveVapiAccount(id);
    await vapiFetch(account.privateKey, `/phone-number/${parsed.data.vapiPhoneNumberId}`, {
      method: "PATCH",
      body: { assistantId: sync.vapiAssistantId },
    });
    await db
      .delete(phoneNumbers)
      .where(or(eq(phoneNumbers.workspaceId, id), eq(phoneNumbers.vapiPhoneNumberId, parsed.data.vapiPhoneNumberId)));
    const [row] = await db
      .insert(phoneNumbers)
      .values({
        workspaceId: id,
        vapiPhoneNumberId: parsed.data.vapiPhoneNumberId,
        e164: parsed.data.e164,
        assistantId: assistant.id,
      })
      .returning();
    return Response.json({ phoneNumber: row });
  } catch (error) {
    return errorResponse(422, error instanceof Error ? error.message : "Could not assign phone number");
  }
});
