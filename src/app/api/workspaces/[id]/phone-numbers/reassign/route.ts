import { z } from "zod";
import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { numberInput, phoneWorkspaceExists, submitPhoneNumberChange } from "@/lib/vapi/phone-number-api";
import { listPhoneNumbers } from "@/lib/vapi/phone-numbers";

type Ctx = RouteContext<"/api/workspaces/[id]/phone-numbers/reassign">;

const reassignInput = numberInput.extend({ sourceWorkspaceId: z.uuid(), operationId: z.uuid() });

export const GET = withAdmin(async (_admin, _request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await phoneWorkspaceExists(id))) return errorResponse(404, "Workspace not found");
  try {
    const { transfers, providerError } = await listPhoneNumbers(id, true);
    if (providerError) return errorResponse(422, providerError);
    return Response.json({ transfers });
  } catch {
    return errorResponse(503, "Could not load the phone number assignments.");
  }
});

export const POST = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await phoneWorkspaceExists(id))) return errorResponse(404, "Workspace not found");
  const parsed = reassignInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Select a number and its source workspace", fieldErrors(parsed.error));
  return submitPhoneNumberChange(id, parsed.data);
});
