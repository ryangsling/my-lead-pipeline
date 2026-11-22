import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { getIntegration } from "@/lib/integrations/store";

type Channel = { type: string; target: string };
type Message = { subject: string; body: string };
type Provider =
  | { kind: "telegram"; token: string; target: string }
  | { kind: "resend"; token: string; from: string; target: string }
  | { kind: "smtp"; host: string; port: number; user: string; password: string; from: string; target: string };
export type PreparedDelivery = Provider & { fingerprint: string };
export type SendOutcome = "accepted" | "rejected" | "uncertain";

export async function prepareDelivery(workspaceId: string, channel: Channel): Promise<PreparedDelivery | null> {
  let provider: Provider | undefined;
  if (channel.type === "telegram") {
    const token = (await getIntegration("telegram", workspaceId))?.creds.botToken;
    if (token) provider = { kind: "telegram", token, target: channel.target };
  } else if (channel.type === "email") {
    const resend = await getIntegration("resend", workspaceId);
    if (resend?.creds.apiKey && resend.config.from) {
      provider = { kind: "resend", token: resend.creds.apiKey, from: resend.config.from, target: channel.target };
    } else {
      const smtp = await getIntegration("smtp", workspaceId);
      if (smtp?.creds.password && smtp.config.host) {
        provider = {
          kind: "smtp", host: smtp.config.host, port: Number(smtp.config.port), user: smtp.config.user,
          password: smtp.creds.password, from: smtp.config.from, target: channel.target,
        };
      }
    }
  }
  if (!provider) return null;
  const fingerprint = createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "base64"))
    .update(JSON.stringify(provider)).digest("hex");
  return { ...provider, fingerprint };
}

async function sendMail(provider: Extract<PreparedDelivery, { kind: "smtp" }>, message: Message, timeoutMs: number): Promise<SendOutcome> {
  const transport = nodemailer.createTransport({
    pool: true,
    maxRequeues: 0,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    host: provider.host,
    port: provider.port,
    secure: provider.port === 465,
    auth: { user: provider.user, pass: provider.password },
  });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const result = await Promise.race([
      new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true })),
      transport.sendMail({ from: provider.from, to: provider.target, subject: message.subject, text: message.body }),
    ]);
    if (!result) return "uncertain";
    return result.accepted.length ? "accepted" : "rejected";
  } catch (error) {
    const code = (error as { responseCode?: number }).responseCode;
    return code && code >= 400 && code < 600 ? "rejected" : "uncertain";
  } finally {
    transport.close();
  }
}

/** A network interruption or opaque server error leaves acceptance unknown. */
export async function sendMessage(
  provider: PreparedDelivery, message: Message, { idempotencyKey, timeoutMs }: { idempotencyKey: string; timeoutMs: number },
): Promise<SendOutcome> {
  if (provider.kind === "smtp") return sendMail(provider, message, timeoutMs);
  const resend = provider.kind === "resend";
  try {
    const response = await fetch(resend ? "https://api.resend.com/emails" : `https://api.telegram.org/bot${provider.token}/sendMessage`, {
      signal: AbortSignal.timeout(timeoutMs),
      method: "POST",
      redirect: "error",
      headers: resend
        ? { "content-type": "application/json", authorization: `Bearer ${provider.token}`, "idempotency-key": idempotencyKey }
        : { "content-type": "application/json" },
      body: JSON.stringify(resend
        ? { from: provider.from, to: [provider.target], subject: message.subject, text: message.body }
        : { chat_id: provider.target, text: `${message.subject}\n\n${message.body}` }),
    });
    if (response.ok) {
      const reply = await response.json() as { id?: unknown; ok?: unknown };
      if (resend ? typeof reply?.id === "string" && reply.id.length > 0 : reply?.ok === true) return "accepted";
      if (!resend && reply?.ok === false) return "rejected";
      return "uncertain";
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409) return "rejected";
    return "uncertain";
  } catch {
    return "uncertain";
  }
}
