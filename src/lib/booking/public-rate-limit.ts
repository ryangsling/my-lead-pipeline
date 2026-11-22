import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, like, lt, sql, TransactionRollbackError } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const publicBookingLimits = { workspace: 20, client: 5, windowSeconds: 600 };
const prefix = "public-booking:";

function clientKey(headers: Headers) {
  const header = env.PUBLIC_BOOKING_TRUSTED_IP_HEADER;
  const ip = header && headers.get(header);
  if (!ip || ip.includes("%")) return "unknown";
  const family = isIP(ip);
  if (!family) return "unknown";
  let address = family === 4 ? ip : new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(address);
  if (mapped) address = mapped.slice(1).flatMap(part => {
    const bytes = parseInt(part, 16);
    return [bytes >> 8, bytes & 255];
  }).join(".");
  return createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "base64"))
    .update(`${prefix}${address}`).digest("hex");
}

/** Returns the Retry-After value when either budget is exhausted. */
export async function limitPublicBooking(workspaceId: string, headers: Headers) {
  const now = Date.now();
  const windowMs = publicBookingLimits.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const workspaceKey = `${prefix}${workspaceId}`;
  const client = `${workspaceKey}:${clientKey(headers)}`;
  try {
    await db.transaction(async tx => {
      for (const [key, limit] of [
        [client, publicBookingLimits.client],
        [workspaceKey, publicBookingLimits.workspace],
      ] as const) {
        const [counted] = await tx.insert(rateLimits).values({ key, windowStart, count: 1 })
          .onConflictDoUpdate({
            target: [rateLimits.key, rateLimits.windowStart],
            set: { count: sql`${rateLimits.count} + 1` },
            setWhere: lt(rateLimits.count, limit),
          }).returning({ key: rateLimits.key });
        if (!counted) tx.rollback();
      }
    });
    return null;
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
    return Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
  }
}

export async function prunePublicBookingLimits() {
  await db.delete(rateLimits).where(and(like(rateLimits.key, `${prefix}%`), lt(rateLimits.windowStart, new Date(Date.now() - 86_400_000))));
}
