import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { NotificationChannels } from "@/components/notification-channels";
import { getIntegration } from "@/lib/integrations/store";
import { listChannels, listLog } from "@/lib/notifications/channels";
import { eventLabels, notificationEvents } from "@/lib/notifications/format";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function NotificationsPage({ params }: PageProps<"/w/[slug]/notifications">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const [channels, log, telegram] = await Promise.all([listChannels(w.id), listLog(w.id), getIntegration("telegram", w.id)]);
  const when = (d: Date) => DateTime.fromJSDate(d, { zone: w.timezone }).toFormat("d LLL, HH:mm:ss");

  return (
    <>
      <h1 className="mb-4 text-xl font-medium">Notifications for {w.name}</h1>
      <NotificationChannels
        workspaceId={w.id}
        telegramChatId={telegram?.config.chatId ?? ""}
        events={notificationEvents.map((value) => ({ value, label: eventLabels[value] }))}
        initial={channels.map((c) => ({ id: c.id, type: c.type as "telegram" | "email", target: c.target, events: c.events, active: c.active }))}
      />

      <h2 className="mt-8 mb-2 font-medium">Recent attempts</h2>
      {log.length === 0 ? (
        <p className="text-sm">Nothing sent yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3">When</th>
              <th className="pr-3">Event</th>
              <th className="pr-3">Channel</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Attempts</th>
              <th className="pr-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{when(l.createdAt)}</td>
                <td className="pr-3">{eventLabels[l.event as keyof typeof eventLabels] ?? l.event}</td>
                <td className="pr-3">{l.type ? `${l.type}: ${l.target}` : "removed"}</td>
                <td className="pr-3">{l.status}</td>
                <td className="pr-3">{l.attempts}</td>
                <td className="pr-3">{l.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
