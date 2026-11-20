import { assistantInput, getAssistant, missingNotice, saveAssistant } from "@/lib/agent/store";
import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/assistant">;

export const PUT = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const parsed = assistantInput.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid agent", fieldErrors(parsed.error));
  if (missingNotice(parsed.data.firstMessage)) {
    return errorResponse(422, "Invalid agent", {
      firstMessage: "The first message must say it is an AI assistant and that the call may be recorded",
    });
  }
  return Response.json({ assistant: await saveAssistant(id, parsed.data) });
});

export const GET = withAdmin(async (_admin, _request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  return Response.json({ assistant: (await getAssistant(id)) ?? null });
});
