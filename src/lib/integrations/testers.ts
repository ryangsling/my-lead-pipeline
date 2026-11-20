import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import type { Fields, Provider } from "./providers";

export type TestResult = { ok: true } | { ok: false; error: string };
type Tester = (f: Fields) => Promise<TestResult>;

const need = (f: Fields, ...keys: string[]): TestResult | null => {
  const missing = keys.filter((k) => !f[k]);
  return missing.length ? { ok: false, error: `Missing: ${missing.join(", ")}` } : null;
};

/** Provider error text is returned unchanged. */
async function check(res: Response): Promise<TestResult> {
  return res.ok ? { ok: true } : { ok: false, error: (await res.text()) || `HTTP ${res.status}` };
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const vapi: Tester = async (f) => {
  const missing = need(f, "privateKey");
  if (missing) return missing;
  const headers = { authorization: `Bearer ${f.privateKey}` };
  for (const path of ["assistant", "phone-number"]) {
    const result = await check(await fetch(`https://api.vapi.ai/${path}?limit=1`, { headers }));
    if (!result.ok) return result;
  }
  return { ok: true };
};

/** Exchanges the stored refresh token for an access token. */
const google: Tester = async (f) => {
  const missing = need(f, "refreshToken");
  if (missing) return missing;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { ok: false, error: "Google OAuth is not configured" };
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: f.refreshToken,
    grant_type: "refresh_token",
  });
  return check(await fetch("https://oauth2.googleapis.com/token", { method: "POST", body }));
};

const openrouter: Tester = async (f) => {
  const missing = need(f, "apiKey", "model");
  if (missing) return missing;
  const base = (f.baseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  return check(
    await fetch(
      `${base}/chat/completions`,
      json({ model: f.model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }, { authorization: `Bearer ${f.apiKey}` }),
    ),
  );
};

const telegram: Tester = async (f) => {
  const missing = need(f, "botToken", "chatId");
  if (missing) return missing;
  return check(
    await fetch(`https://api.telegram.org/bot${f.botToken}/sendMessage`, json({ chat_id: f.chatId, text: "Agent Hub test message" })),
  );
};

const resend: Tester = async (f) => {
  const missing = need(f, "apiKey", "from", "to");
  if (missing) return missing;
  return check(
    await fetch(
      "https://api.resend.com/emails",
      json({ from: f.from, to: [f.to], subject: "Agent Hub test email", text: "Agent Hub test email" }, { authorization: `Bearer ${f.apiKey}` }),
    ),
  );
};

const smtp: Tester = async (f) => {
  const missing = need(f, "host", "port", "user", "password", "from", "to");
  if (missing) return missing;
  const transport = nodemailer.createTransport({
    host: f.host,
    port: Number(f.port),
    secure: Number(f.port) === 465,
    auth: { user: f.user, pass: f.password },
  });
  await transport.sendMail({ from: f.from, to: f.to, subject: "Agent Hub test email", text: "Agent Hub test email" });
  return { ok: true };
};

const testers: Record<Provider, Tester> = { vapi, google, openrouter, telegram, resend, smtp };

/** `fields` holds the decrypted secrets and config. Email providers also need `to`, the admin's address. */
export async function testProvider(provider: Provider, fields: Fields): Promise<TestResult> {
  try {
    return await testers[provider](fields);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Recent chats that messaged the bot, so the admin can pick a chat id. */
export async function findTelegramChats(botToken: string): Promise<{ id: string; name: string }[] | { error: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  if (!res.ok) return { error: (await res.text()) || `HTTP ${res.status}` };
  const { result } = (await res.json()) as { result: { message?: { chat: { id: number; title?: string; username?: string; first_name?: string } } }[] };
  const chats = new Map<string, string>();
  for (const { message } of result) {
    if (message) chats.set(String(message.chat.id), message.chat.title ?? message.chat.username ?? message.chat.first_name ?? "");
  }
  return [...chats].map(([id, name]) => ({ id, name }));
}
