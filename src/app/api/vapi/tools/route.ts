import { db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { runTool } from "@/lib/tools/run";
import { authenticateVapi } from "@/lib/vapi/auth";

type ToolCall = { id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } };
type Body = {
  message?: {
    type?: string;
    call?: { id?: string; assistantId?: string; type?: string };
    toolCallList?: ToolCall[];
  };
};

/** Vapi sends arguments as an object; a JSON string is accepted too. */
function argumentsOf(call: ToolCall): unknown {
  const raw = call.function?.arguments ?? call.arguments ?? {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** One statement: creates the conversation for this call, or touches the existing one. */
async function conversationFor(workspaceId: string, callId: string, callType?: string) {
  const now = new Date();
  const [row] = await db
    .insert(conversations)
    .values({
      workspaceId,
      channel: callType === "webCall" ? "web_voice" : "phone",
      externalId: callId,
      startedAt: now,
      lastActivityAt: now,
    })
    .onConflictDoUpdate({ target: [conversations.workspaceId, conversations.externalId], set: { lastActivityAt: now } })
    .returning({ id: conversations.id });
  return row.id;
}

/** Vapi tool calls. The workspace comes from the assistant id; tool errors come back as sentences. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const message = body?.message;
  const call = message?.call;
  if (message?.type !== "tool-calls" || !call?.id || !call.assistantId || !Array.isArray(message.toolCallList)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const auth = await authenticateVapi(request, call.assistantId);
  if (!auth) return Response.json({ error: "Invalid Vapi secret" }, { status: 401 });

  const conversationId = await conversationFor(auth.workspaceId, call.id, call.type);
  const ctx = {
    workspaceId: auth.workspaceId,
    conversationId,
    channel: call.type === "webCall" ? ("web_voice" as const) : ("phone" as const),
  };

  const results: { name: string; toolCallId: string; result: string }[] = [];
  const log: (typeof messages.$inferInsert)[] = [];
  for (const toolCall of message.toolCallList) {
    const name = toolCall.function?.name ?? toolCall.name ?? "";
    const args = argumentsOf(toolCall);
    const { result } = await runTool(name, args, ctx);
    results.push({ name, toolCallId: toolCall.id ?? "", result });
    log.push(
      { conversationId, role: "tool_call", toolName: name, content: JSON.stringify(args) },
      { conversationId, role: "tool_result", toolName: name, content: result },
    );
  }
  if (log.length) await db.insert(messages).values(log);

  return Response.json({ results });
}
