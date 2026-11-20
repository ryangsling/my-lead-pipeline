import { createHmac, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { env } from "@/lib/env";

export const calendarScope = "https://www.googleapis.com/auth/calendar";

export function googleConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(redirectUri?: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured");
  }
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

/** State is the workspace id and an expiry, signed with the cron secret. */
export function signState(workspaceId: string, now = Date.now()) {
  const payload = `${workspaceId}.${now + 10 * 60_000}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", env.CRON_SECRET).update(payload).digest("base64url")}`;
}

export function verifyState(state: string): string | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = createHmac("sha256", env.CRON_SECRET).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  const [workspaceId, expires] = payload.split(".");
  if (!workspaceId || !expires || Number(expires) < Date.now()) return null;
  return workspaceId;
}
