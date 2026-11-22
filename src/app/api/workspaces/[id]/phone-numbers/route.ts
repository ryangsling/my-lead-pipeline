import { z } from "zod";
import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { numberInput, phoneWorkspaceExists, submitPhoneNumberChange } from "@/lib/vapi/phone-number-api";
import { listPhoneNumbers } from "@/lib/vapi/phone-numbers";

type Ctx = RouteContext<"/api/workspaces/[id]/phone-numbers">;

export const GET = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await phoneWorkspaceExists(id))) return errorResponse(404, "Workspace not found");
  try {
    const operationId = z.uuid().safeParse(new URL(request.url).searchParams.get("operationId")).data;
    const { numbers, assigned, change, operation, providerError } = await listPhoneNumbers(id, false, operationId);
    return Response.json({ numbers, assigned, change, operation, providerError });
  } catch {
    return errorResponse(503, "Could not load the phone number assignments.");
  }
});

export const POST = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await phoneWorkspaceExists(id))) return errorResponse(404, "Workspace not found");
  const parsed = numberInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Invalid phone number", fieldErrors(parsed.error));
  return submitPhoneNumberChange(id, {
    ...parsed.data,
    operationId: parsed.data.operationId ?? crypto.randomUUID(),
    sourceWorkspaceId: null,
  });
});
