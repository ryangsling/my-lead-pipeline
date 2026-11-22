import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, count, eq, inArray, lt, sql, TransactionRollbackError } from "drizzle-orm";
import { DateTime } from "luxon";
import { renderPrompt } from "@/lib/agent/prompt";
import { getAssistant } from "@/lib/agent/store";
import { db } from "@/lib/db/client";
import { conversations, embeds, messages, rateLimits, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getWorkspace } from "@/lib/workspaces";

export async function findChatWorkspace(publicKey: string) {
  const [target] = await db.select({
    workspaceId: embeds.workspaceId, slug: workspaces.slug, allowedOrigins: embeds.allowedOrigins,
  }).from(embeds).innerJoin(workspaces, eq(workspaces.id, embeds.workspaceId))
    .where(and(eq(embeds.publicKey, publicKey), eq(embeds.chatEnabled, true), eq(workspaces.status, "active")));
  return target;
}

export function chatOrigin(request: Request, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.APP_URL).origin && origin !== new URL(request.url).origin && !allowedOrigins.includes(origin)) return null;
  const headers = new Headers({ vary: "Origin" });
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

export async function admitChat(workspaceId: string, headers: Headers) {
  const windowMs = 10 * 60_000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const prefix = `chat:${workspaceId}:`;
  const supplied = env.CHAT_TRUSTED_IP_HEADER ? headers.get(env.CHAT_TRUSTED_IP_HEADER) : null;
  const key = supplied && isIP(supplied)
    ? createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "base64")).update(supplied).digest("hex")
    : "unknown";
  try {
    await db.transaction(async tx => {
      for (const [bucket, limit] of [[prefix + key, 20], [prefix + "workspace", 120]] as const) {
        const [row] = await tx.insert(rateLimits).values({ key: bucket, windowStart, count: 1 })
          .onConflictDoUpdate({
            target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` },
            setWhere: lt(rateLimits.count, limit),
          }).returning({ key: rateLimits.key });
        if (!row) tx.rollback();
      }
    });
    return 0;
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
    return Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
  }
}

export async function startChatTurn(workspaceId: string, sessionId: string, text: string) {
  const externalId = `chat:${sessionId}`;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId + externalId}, 472))`);
    const key = and(eq(conversations.workspaceId, workspaceId), eq(conversations.channel, "chat"), eq(conversations.externalId, externalId));
    await tx.insert(conversations).values({ workspaceId, externalId, channel: "chat", startedAt: new Date() }).onConflictDoNothing();
    const [conversation] = await tx.select().from(conversations).where(key);
    if (!conversation || (conversation.chatLeaseUntil && conversation.chatLeaseUntil > new Date())) return { status: "busy" } as const;
    const thread = and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversation.id));
    const [turns] = await tx.select({ count: count() }).from(messages)
      .where(and(thread, eq(messages.role, "user")));
    if (turns.count >= 30) return { status: "limited" } as const;
    const history = await tx.select({ role: messages.role, content: messages.content }).from(messages)
      .where(and(thread, inArray(messages.role, ["user", "assistant"])))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const turnId = crypto.randomUUID();
    await tx.update(conversations).set({ chatTurnId: turnId, chatLeaseUntil: new Date(Date.now() + 240_000), lastActivityAt: new Date() })
      .where(and(key, eq(conversations.id, conversation.id)));
    await tx.insert(messages).values({ workspaceId, conversationId: conversation.id, role: "user", content: text });
    return { status: "started", conversationId: conversation.id, turnId,
      history: [...history, { role: "user", content: text }].map(message => ({
        role: message.role === "user" ? "user" as const : "assistant" as const,
        content: message.content,
      })) } as const;
  });
}

export async function finishChatTurn(input: {
  workspaceId: string; conversationId: string; turnId: string; text: string; providerName?: string; providerModel?: string;
}) {
  await db.transaction(async tx => {
    const [owned] = await tx.update(conversations).set({ chatTurnId: null, chatLeaseUntil: null, lastActivityAt: new Date() })
      .where(and(eq(conversations.workspaceId, input.workspaceId), eq(conversations.id, input.conversationId),
        eq(conversations.chatTurnId, input.turnId))).returning({ id: conversations.id });
    if (owned && input.text) await tx.insert(messages).values({
      workspaceId: input.workspaceId, conversationId: input.conversationId, role: "assistant", content: input.text,
      providerName: input.providerName, providerModel: input.providerModel,
    });
  });
}

export async function chatPrompt(workspaceId: string) {
  const [workspace, assistant, offered] = await Promise.all([
    getWorkspace(workspaceId), getAssistant(workspaceId), db.select().from(services).where(eq(services.workspaceId, workspaceId)),
  ]);
  if (!workspace) throw new Error("Chat workspace missing");
  const today = DateTime.now().setZone(workspace.timezone).toFormat("cccc d LLLL yyyy");
  const template = assistant?.systemPrompt ?? "You are the receptionist for {{business_name}}. Services: {{services}}.";
  return [
    renderPrompt(template.replaceAll("{{today}}", today), workspace, offered),
    assistant?.knowledge,
    `Today is ${today}. You are the business’s AI chat assistant. Identify yourself as AI in your first reply. Never claim this is a voice call or give a recording notice. Use only the configured tools and services. If you cannot help, offer to take a callback number.`,
  ].filter(Boolean).join("\n\n");
}
