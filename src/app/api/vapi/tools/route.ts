import { and, eq } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { conversations, messages, toolReceipts } from "@/lib/db/schema";
import { callErased, lockPrivacy } from "@/lib/privacy/scope";
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

async function conversationFor(workspaceId: string, callId: string, assistantId: string, callType?: string) {
  const now = new Date();
  return db.transaction(async tx => {
    await lockPrivacy(tx, workspaceId);
    if (await callErased(workspaceId, callId, tx)) return null;
    const [row] = await tx.insert(conversations).values({
      workspaceId, channel: callType === "webCall" ? "web_voice" : "phone", externalId: callId,
      vapiAssistantId: assistantId, startedAt: now, lastActivityAt: now,
    }).onConflictDoUpdate({ target: [conversations.workspaceId, conversations.externalId], set: { lastActivityAt: now } })
      .returning({ id: conversations.id });
    return row.id;
  });
}

/** Vapi tool calls. The workspace comes from the assistant id; tool errors come back as sentences. */
export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid payload" }, { status: 400 });
  const { message } = body.data;
  const { call } = message;

  const auth = await authenticateVapi(request, call.assistantId);
  if (!auth) return Response.json({ error: "Invalid Vapi secret" }, { status: 401 });

  const unavailable = () => Response.json({ results: message.toolCallList.map((item) => ({
      name: item.function?.name ?? item.name ?? "",
      toolCallId: item.id ?? "",
      result: "We can't book right now. Please call back.",
    })) });
  if (auth.status === "archived") return unavailable();

  const conversationId = await conversationFor(auth.workspaceId, call.id, call.assistantId, call.type);
  if (!conversationId) return unavailable();
  const ctx = {
    workspaceId: auth.workspaceId,
    conversationId,
    workspace: auth,
    channel: call.type === "webCall" ? ("web_voice" as const) : ("phone" as const),
    defer: after,
  };

  const results: { name: string; toolCallId: string; result: string }[] = [];
  for (const item of message.toolCallList) {
    const name = item.function?.name ?? item.name ?? "";
    const args = item.function?.arguments ?? item.arguments ?? {};
    const key = { workspaceId: auth.workspaceId, callId: call.id, toolCallId: item.id };
    const where = and(eq(toolReceipts.workspaceId, key.workspaceId), eq(toolReceipts.callId, call.id), eq(toolReceipts.toolCallId, item.id));
    // Commit the claim before any external side effect. An interrupted claim is never re-executed.
    const claim = await db.transaction(async tx => {
      await lockPrivacy(tx, auth.workspaceId);
      if (await callErased(auth.workspaceId, call.id, tx)) return "erased" as const;
      const [claimed] = await tx.insert(toolReceipts).values({ ...key, name }).onConflictDoNothing().returning();
      return claimed ? "claimed" as const : "previous" as const;
    });
    if (claim === "erased") return unavailable();
    if (claim === "previous") {
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
    const saved = await db.transaction(async (tx) => {
      await lockPrivacy(tx, auth.workspaceId);
      const [row] = await tx.update(toolReceipts).set({ result }).where(where).returning({ callId: toolReceipts.callId });
      if (!row) return false;
      await tx.insert(messages).values([
        { workspaceId: auth.workspaceId, conversationId, role: "tool_call", toolName: name, content: JSON.stringify(args) },
        { workspaceId: auth.workspaceId, conversationId, role: "tool_result", toolName: name, content: result },
      ]);
      return true;
    });
    if (!saved) return unavailable();
    results.push({ name, toolCallId: item.id, result });
  }

  return Response.json({ results });
}
