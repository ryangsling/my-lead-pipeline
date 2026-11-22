import { after } from "next/server";
import { callErased } from "@/lib/privacy/scope";
import { authenticateVapi } from "@/lib/vapi/auth";
import { transferDestination } from "@/lib/vapi/transfer";
import { processWebhookAfterReply, recordWebhook } from "@/lib/vapi/events";
import { recordingConsentAt, recordingEnabledFor, stripVapiCaptureLinks } from "@/lib/vapi/recording";

type EventBody = {
  message?: {
    type?: string;
    status?: string;
    call?: { id?: string; assistantId?: string };
    [key: string]: unknown;
  };
};

/** Vapi echoes server.headers at any depth, including x-vapi-secret. Never store them. */
function stripServerHeaders(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(stripServerHeaders);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const server = record.server;
  if (server && typeof server === "object" && !Array.isArray(server)) {
    delete (server as Record<string, unknown>).headers;
  }
  Object.values(record).forEach(stripServerHeaders);
}

function unauthorized() {
  return Response.json({ error: "Invalid Vapi secret" }, { status: 401 });
}

/** Stores every Vapi event raw, answers 200, then ingests end-of-call reports after the reply. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as EventBody | null;
  const message = body?.message;
  const callId = message?.call?.id;
  const vapiAssistantId = message?.call?.assistantId;
  if (!message?.type || !callId || !vapiAssistantId) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const auth = await authenticateVapi(request, vapiAssistantId);
  if (!auth) return unauthorized();

  if (message.type === "transfer-destination-request") {
    const destination = await callErased(auth.workspaceId, callId) ? null : await transferDestination(auth.workspaceId, callId);
    return Response.json(destination ? { destination } : { error: "Live connection is unavailable. Offer a callback." });
  }

  stripServerHeaders(message);
  const consent = recordingConsentAt(message);
  stripVapiCaptureLinks(body, consent !== null && await recordingEnabledFor(auth.workspaceId));

  const externalId =
    message.type === "end-of-call-report"
      ? callId
      : message.type === "status-update"
        ? `${callId}:${message.status}`
        : `${callId}:${message.type}`;

  const key = { workspaceId: auth.workspaceId, source: "vapi" as const, externalId };
  const recorded = await recordWebhook(key, message.type, body, callId, vapiAssistantId);
  if (recorded && message.type === "end-of-call-report") after(() => processWebhookAfterReply(key));

  return Response.json({ ok: true });
}
