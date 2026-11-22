import { z } from "zod";
import { answerChat, CHAT_UNAVAILABLE } from "@/lib/chat/model";
import { resolveChatProviders } from "@/lib/chat/providers";
import { admitChat, chatOrigin, chatPrompt, findChatWorkspace, finishChatTurn, startChatTurn } from "@/lib/chat/session";
import { db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { deliverNotifications, enqueue } from "@/lib/notifications/send";

type Ctx = RouteContext<"/api/public/[pk]/chat">;
const input = z.object({ sessionId: z.uuid(), message: z.string().trim().min(1).max(2_000) });
export const maxDuration = 180;

export async function OPTIONS(request: Request, { params }: Ctx) {
  const target = await findChatWorkspace((await params).pk);
  if (!target) return new Response(null, { status: 404 });
  const headers = chatOrigin(request, target.allowedOrigins);
  if (!headers) return new Response(null, { status: 403 });
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request, { params }: Ctx) {
  const target = await findChatWorkspace((await params).pk);
  if (!target) return Response.json({ error: "Chat is unavailable." }, { status: 404 });
  const headers = chatOrigin(request, target.allowedOrigins);
  if (!headers) return Response.json({ error: "Chat is unavailable for this origin." }, { status: 403 });
  headers.set("cache-control", "no-store");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send a valid session ID and a message of up to 2,000 characters." }, { status: 422, headers });
  const { workspaceId, slug } = target;
  const retryAfter = await admitChat(workspaceId, request.headers);
  if (retryAfter) {
    headers.set("retry-after", String(retryAfter));
    return Response.json({ error: "Too many chat messages. Please try again later." }, { status: 429, headers });
  }
  const turn = await startChatTurn(workspaceId, parsed.data.sessionId, parsed.data.message);
  if (turn.status === "limited") return Response.json({ error: "This session has ended. Please contact the business directly." }, { status: 429, headers });
  if (turn.status === "busy") return Response.json({ error: "Please wait for the current reply." }, { status: 409, headers });

  const { conversationId, turnId } = turn;
  const encoder = new TextEncoder();
  const disconnect = new AbortController();
  const signal = AbortSignal.any([request.signal, disconnect.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let providerName: string | undefined;
      let providerModel: string | undefined;
      const write = (chunk: string) => {
        if (signal.aborted) return;
        controller.enqueue(encoder.encode(chunk));
        text += chunk;
      };
      let unavailable = false;
      try {
        const [providers, system] = await Promise.all([resolveChatProviders(workspaceId), chatPrompt(workspaceId)]);
        const result = await answerChat({
          providers, system, workspaceId, conversationId, history: turn.history, signal, write,
          logTool: async (provider, name, args, output) => {
            await db.insert(messages).values([
              { workspaceId, conversationId, role: "tool_call", toolName: name, content: JSON.stringify(args), providerName: provider.name, providerModel: provider.model },
              { workspaceId, conversationId, role: "tool_result", toolName: name, content: output, providerName: provider.name, providerModel: provider.model },
            ]);
          },
        });
        providerName = result.provider?.name;
        providerModel = result.provider?.model;
        unavailable = result.unavailable;
      } catch {
        if (!signal.aborted && !text) {
          write(CHAT_UNAVAILABLE);
          unavailable = true;
        }
      } finally {
        await finishChatTurn({ workspaceId, conversationId, turnId, text, providerName, providerModel })
          .catch(() => console.error("Could not save chat turn", turnId));
        if (unavailable) {
          await enqueue(workspaceId, "chat_unavailable", {
            summary: "The chatbot could not reach a configured provider.",
            link: `${env.APP_URL.replace(/\/$/, "")}/w/${slug}/conversations/${conversationId}`,
          }, `chat_unavailable:${turnId}`)
            .then(rows => deliverNotifications(rows, { once: true, timeoutMs: 4_000 }))
            .catch(() => {});
        }
        if (!disconnect.signal.aborted) controller.close();
      }
    },
    cancel() { disconnect.abort(); },
  });
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("x-accel-buffering", "no");
  return new Response(stream, { headers });
}
