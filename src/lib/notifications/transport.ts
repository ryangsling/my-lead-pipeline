import nodemailer from "nodemailer";
import { getIntegration } from "@/lib/integrations/store";

export type Channel = { type: string; target: string };
export type Message = { subject: string; body: string };

async function failure(res: Response) {
  return new Error((await res.text()) || `HTTP ${res.status}`);
}

async function telegram(workspaceId: string, chatId: string, message: Message) {
  const botToken = (await getIntegration("telegram", workspaceId))?.creds.botToken;
  if (!botToken) throw new Error("Telegram is not connected. Add the bot token in integrations.");
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: `${message.subject}\n\n${message.body}` }),
  });
  if (!res.ok) throw await failure(res);
}

/** Resend when it is set up, otherwise SMTP. */
async function email(workspaceId: string, to: string, message: Message) {
  const resend = await getIntegration("resend", workspaceId);
  if (resend?.creds.apiKey && resend.config.from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${resend.creds.apiKey}` },
      body: JSON.stringify({ from: resend.config.from, to: [to], subject: message.subject, text: message.body }),
    });
    if (!res.ok) throw await failure(res);
    return;
  }
  const smtp = await getIntegration("smtp", workspaceId);
  if (!smtp?.creds.password || !smtp.config.host) throw new Error("No email provider is set up. Add Resend or SMTP in integrations.");
  const transport = nodemailer.createTransport({
    host: smtp.config.host,
    port: Number(smtp.config.port),
    secure: Number(smtp.config.port) === 465,
    auth: { user: smtp.config.user, pass: smtp.creds.password },
  });
  await transport.sendMail({ from: smtp.config.from, to, subject: message.subject, text: message.body });
}

/** Sends one message. Throws with the provider's own error text. */
export async function sendMessage(workspaceId: string, channel: Channel, message: Message) {
  if (channel.type === "telegram") return telegram(workspaceId, channel.target, message);
  if (channel.type === "email") return email(workspaceId, channel.target, message);
  throw new Error(`Unsupported channel type: ${channel.type}`);
}
