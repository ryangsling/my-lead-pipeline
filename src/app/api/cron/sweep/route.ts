import { timingSafeEqual } from "node:crypto";
import { reconcilePendingAppointments } from "@/lib/booking/reconcile";
import { prunePublicBookingLimits } from "@/lib/booking/public-rate-limit";
import { env } from "@/lib/env";
import { sweepNotifications } from "@/lib/notifications/send";
import { sweepUrgentDeadlines } from "@/lib/notifications/urgent";
import { sweepWebhooks } from "@/lib/vapi/events";
import { sweepPhoneNumbers } from "@/lib/vapi/phone-numbers";
import { sweepLocalRetention } from "@/lib/privacy/erase";
import { sweepProviderDeletions } from "@/lib/privacy/providers";

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const retention = await sweepLocalRetention().catch(() => ({ error: "Retention sweep failed" }));
  const [appointments, delivery, phoneNumbers, providerDeletions] = await Promise.all([
    reconcilePendingAppointments(),
    (async () => {
      const [urgent, webhooks] = await Promise.all([sweepUrgentDeadlines(), sweepWebhooks()]);
      return { urgent, webhooks, notifications: await sweepNotifications() };
    })(),
    sweepPhoneNumbers(),
    sweepProviderDeletions(),
    prunePublicBookingLimits(),
  ]);
  return Response.json({ appointments, ...delivery, phoneNumbers, retention, providerDeletions });
}
