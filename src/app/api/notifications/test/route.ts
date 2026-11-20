import { z } from "zod";
import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { sendTest } from "@/lib/notifications/send";

const body = z.object({ workspaceId: z.uuid(), channelId: z.uuid() });

/** Sends a test message to one saved channel and reports the provider's answer. */
export const POST = withAdmin(async (_admin, request: Request) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Invalid request", fieldErrors(parsed.error));
  const result = await sendTest(parsed.data.workspaceId, parsed.data.channelId);
  if (!result) return errorResponse(404, "Channel not found");
  return Response.json(result, { status: result.ok ? 200 : 502 });
});
