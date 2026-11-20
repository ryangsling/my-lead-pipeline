import { errorResponse, withAdmin } from "@/lib/api";
import { getExactIntegration } from "@/lib/integrations/store";
import { findTelegramChats } from "@/lib/integrations/testers";

/** "Find my chat id": lists chats that pressed Start on the saved bot. */
export const GET = withAdmin(async () => {
  const row = await getExactIntegration("telegram", null);
  if (!row?.creds.botToken) return errorResponse(422, "Save the bot token first");
  const chats = await findTelegramChats(row.creds.botToken);
  return "error" in chats ? errorResponse(422, chats.error) : Response.json({ chats });
});
