import { and, eq } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { conversations, messages, toolReceipts } from "@/lib/db/schema";
import { runTool } from "@/lib/tools/run";
import { authenticateVapi } from "@/lib/vapi/auth";

const id = z.string().trim().min(1).max(128);
const fields = z.record(z.string().trim().min(1).max(64), z.string().trim().max(1000))
  .refine((value) => Object.keys(value).length <= 20);
const args = z.union([fields, z.string().max(8192).transform((text, ctx) => {
  try { return JSON.parse(text) as unknown; }
  catch { ctx.addIssue({ code: "custom", message: "Invalid arguments" }); return z.NEVER; }
}).pipe(fields)]);
const tool = z.object({
  id, name: id.optional(), arguments: args.optional(),
  function: z.object({ name: id, arguments: args.optional() }).optional(),
});
const bodySchema = z.object({ message: z.object({
  type: z.literal("tool-calls"), call: z.object({ id, assistantId: id, type: id.optional() }),
  toolCallList: z.array(tool).min(1).max(8),
}) });

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
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid payload" }, { status: 400 });
  const { message } = body.data;
  const { call } = message;

  const auth = await authenticateVapi(request, call.assistantId);
  if (!auth) return Response.json({ error: "Invalid Vapi secret" }, { status: 401 });

  if (auth.status === "archived") {
    const results = message.toolCallList.map((item) => ({
      name: item.function?.name ?? item.name ?? "",
      toolCallId: item.id ?? "",
      result: "We can't book right now. Please call back.",
    }));
    return Response.json({ results });
  }

  const conversationId = await conversationFor(auth.workspaceId, call.id, call.type);
  const ctx = {
    workspaceId: auth.workspaceId,
    conversationId,
    channel: call.type === "webCall" ? ("web_voice" as const) : ("phone" as const),
  };

  const results: { name: string; toolCallId: string; result: string }[] = [];
  for (const item of message.toolCallList) {
    const name = item.function?.name ?? item.name ?? "";
    const args = item.function?.arguments ?? item.arguments ?? {};
    const key = { workspaceId: auth.workspaceId, callId: call.id, toolCallId: item.id };
    const where = and(eq(toolReceipts.workspaceId, key.workspaceId), eq(toolReceipts.callId, call.id), eq(toolReceipts.toolCallId, item.id));
    // Commit the claim before any external side effect. An interrupted claim is never re-executed.
    const [claimed] = await db.insert(toolReceipts).values({ ...key, name }).onConflictDoNothing().returning();
    if (!claimed) {
      const until = Date.now() + 1000;
      let saved;
      do {
        [saved] = await db.select().from(toolReceipts).where(where);
        if (saved?.result) break;
        await sleep(50);
      } while (Date.now() < until);
      if (!saved?.result) return Response.json({ error: "Previous tool call is pending" }, { status: 503, headers: { "Retry-After": "1" } });
      results.push({ name: saved.name, toolCallId: item.id, result: saved.result });
      continue;
    }
    const reply = await runTool(name, args, ctx);
    const result = reply.data ? JSON.stringify({ spoken: reply.result, data: reply.data }) : reply.result;
    await db.transaction(async (tx) => {
      await tx.update(toolReceipts).set({ result }).where(where);
      await tx.insert(messages).values([
        { conversationId, role: "tool_call", toolName: name, content: JSON.stringify(args) },
        { conversationId, role: "tool_result", toolName: name, content: result },
      ]);
    });
    results.push({ name, toolCallId: item.id, result });
  }

  return Response.json({ results });
}
