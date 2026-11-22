import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { getWorkspace } from "@/lib/workspaces";
import { changePhoneNumber, PhoneNumberError } from "./phone-numbers";

export const numberInput = z.object({
  vapiPhoneNumberId: z.string().trim().min(1).max(128),
  operationId: z.uuid().optional(),
});

export async function phoneWorkspaceExists(id: string) {
  return z.uuid().safeParse(id).success && Boolean(await getWorkspace(id));
}

export async function submitPhoneNumberChange(workspaceId: string, request: Parameters<typeof changePhoneNumber>[1]) {
  try {
    const result = await changePhoneNumber(workspaceId, request);
    if (result.status === "rejected") return errorResponse(409, result.error);
    return Response.json(result, { status: result.status === "pending" ? 202 : 200 });
  } catch (error) {
    if (error instanceof PhoneNumberError) return errorResponse(error.status, error.message);
    return errorResponse(503, "Could not confirm the phone number change. Retry to check its status.");
  }
}
