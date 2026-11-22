import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { runTool } from "@/lib/tools/run";
import { chatProviderKey, putInCooldown, recordChatProviderTest, type ChatProvider } from "./providers";
import { chatTools } from "./tools";

const defaultCooldownMs = 5 * 60_000;
const maxToolCalls = 3;

function retryAt(header: string | null) {
  const now = Date.now();
  const value = header?.trim() ?? "";
  const ms = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return new Date(Number.isFinite(ms) && ms <= 8.64e15 ? Math.max(now, ms) : now + defaultCooldownMs);
}

function createModel(provider: ChatProvider, key: string) {
  const response = { status: 0, retryAfter: null as string | null };
  const client = createOpenAICompatible({
    name: "chat-provider",
    baseURL: provider.baseUrl,
    apiKey: key,
    fetch: async (url, init) => {
      const res = await fetch(url, { ...init, redirect: "error", cache: "no-store" });
      response.status = res.status;
      response.retryAfter = res.headers.get("retry-after");
      // Provider error bodies can contain submitted credentials. Give the SDK only the status.
      if (res.ok) return res;
      await res.body?.cancel();
      return new Response(null, { status: res.status });
    },
  });
  return { model: client.chatModel(provider.model), response };
}

/** Buffer only a possible partial key so keys split across chunks are never exposed. */
function redactStream(key: string, write: (text: string) => void) {
  let pending = "";
  const redact = (text: string) => text.replaceAll(key, "[redacted]");
  return {
    push(text: string) {
      pending = redact(pending + text);
      let suffix = Math.min(key.length - 1, pending.length);
      while (suffix && !pending.endsWith(key.slice(0, suffix))) suffix--;
      const safe = pending.slice(0, pending.length - suffix);
      pending = pending.slice(safe.length);
      if (safe) write(safe);
    },
    flush() {
      if (pending) write(pending);
      pending = "";
    },
    discard() { pending = ""; },
  };
}

export const CHAT_UNAVAILABLE = "I’m sorry, chat is temporarily unavailable. Please try again shortly or contact the business directly.";
export const CHAT_INTERRUPTED = "The chat connection was interrupted. Please try again.";

export async function answerChat(input: {
  providers: ChatProvider[];
  history: ModelMessage[];
  system: string;
  workspaceId: string;
  conversationId: string;
  signal: AbortSignal;
  write: (text: string) => void;
  logTool: (provider: ChatProvider, name: string, args: unknown, result: string) => Promise<void>;
}) {
  const history = [...input.history];
  let toolCount = 0;
  for (const provider of input.providers) {
    if (input.signal.aborted) break;
    if (provider.cooldownUntil && provider.cooldownUntil > new Date()) continue;
    let published = false;
    let connection: ReturnType<typeof createModel> | undefined;
    const deadline = AbortSignal.timeout(provider.timeoutMs);
    const signal = AbortSignal.any([input.signal, deadline]);
    let redactor: ReturnType<typeof redactStream> | undefined;
    try {
      const key = chatProviderKey(provider);
      connection = createModel(provider, key);
      redactor = redactStream(key, text => {
        published = true;
        input.write(text);
      });
      for (;;) {
        signal.throwIfAborted();
        const { fullStream } = streamText({
          model: connection.model, system: input.system, messages: history, tools: chatTools, maxOutputTokens: 1024,
          abortSignal: signal, maxRetries: 0, onError: () => {},
        });
        const calls: { toolCallId: string; toolName: keyof typeof chatTools; input: unknown }[] = [];
        let stepText = false;
        for await (const part of fullStream) {
          if (part.type === "error" || part.type === "abort" || part.type === "tool-error" ||
            (part.type === "finish" && part.finishReason === "error")) throw new Error("Chat provider failed");
          if (part.type === "text-delta") {
            if (part.text.trim() || stepText || published) {
              stepText = true;
              redactor.push(part.text);
            }
          }
          if (part.type === "tool-call") {
            if (part.invalid || !Object.hasOwn(chatTools, part.toolName) || JSON.stringify(part.input)?.includes(key)) {
              throw new Error("Invalid chat tool output");
            }
            calls.push({ toolCallId: part.toolCallId, toolName: part.toolName as keyof typeof chatTools, input: part.input });
          }
        }
        signal.throwIfAborted();
        if (!calls.length) {
          if (!stepText) throw new Error("Empty chat response");
          redactor.flush();
          return { provider, unavailable: false };
        }
        if (toolCount + calls.length > maxToolCalls ||
          new Set(calls.map(call => call.toolCallId)).size !== calls.length) throw new Error("Invalid chat tool batch");
        toolCount += calls.length;
        history.push({ role: "assistant", content: calls.map(call => ({ type: "tool-call", ...call })) });
        // Carry executed calls forward on retry, so a provider change does not restart the turn.
        for (const call of calls) {
          const reply = await runTool(call.toolName, call.input, {
            workspaceId: input.workspaceId, conversationId: input.conversationId, channel: "chat",
          });
          const result = JSON.stringify(reply).replaceAll(key, "[redacted]");
          history.push({ role: "tool", content: [{
            type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "text", value: result },
          }] });
          await input.logTool(provider, call.toolName, call.input, result);
        }
      }
    } catch {
      redactor?.discard();
      const status = connection?.response.status ?? 0;
      if (status === 429 && connection) await putInCooldown(provider, retryAt(connection.response.retryAfter)).catch(() => {});
      if (published) {
        if (!input.signal.aborted) input.write(`\n\n${CHAT_INTERRUPTED}`);
        return { provider, unavailable: false };
      }
      if (status >= 400 && status < 500 && status !== 429 && !deadline.aborted) break;
    }
  }
  if (!input.signal.aborted) input.write(CHAT_UNAVAILABLE);
  return { provider: null, unavailable: !input.signal.aborted };
}

export async function testChatProvider(provider: ChatProvider) {
  let passed = false;
  if (provider.toolCapable) {
    let connection: ReturnType<typeof createModel> | undefined;
    try {
      connection = createModel(provider, chatProviderKey(provider));
      const probe = tool({ description: "Confirm tool support.", inputSchema: z.object({ value: z.literal("ready") }) });
      const result = await generateText({
        model: connection.model, tools: { verify_tool_support: probe }, toolChoice: "required",
        prompt: 'Call verify_tool_support exactly once with value "ready".',
        abortSignal: AbortSignal.timeout(provider.timeoutMs), maxRetries: 0,
      });
      passed = result.toolCalls.length === 1 && result.toolCalls[0].toolName === "verify_tool_support" && !result.toolCalls[0].invalid;
    } catch {
      if (connection?.response.status === 429) await putInCooldown(provider, retryAt(connection.response.retryAfter));
    }
  }
  await recordChatProviderTest(provider, passed);
  return passed;
}
