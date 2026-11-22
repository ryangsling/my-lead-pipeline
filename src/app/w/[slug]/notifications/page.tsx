import { EmptyState, StatusBadge } from "@/components/admin-display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <h1 className="mb-3">Notifications</h1>
      <NotificationChannels
        workspaceId={w.id}
        telegramChatId={telegram?.config.chatId ?? ""}
        events={notificationEvents.map((value) => ({ value, label: eventLabels[value] }))}
        initial={channels.map((c) => ({ id: c.id, type: c.type as "telegram" | "email", target: c.target, events: c.events, active: c.active }))}
      />

      <h2 className="mt-8 mb-2 font-medium">Recent attempts</h2>
      {log.length === 0 ? (
        <EmptyState>Nothing sent yet.</EmptyState>
      ) : (
        <Table role="table" className="responsive-table text-left">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead role="columnheader">When</TableHead>
              <TableHead role="columnheader">Event</TableHead>
              <TableHead role="columnheader">Channel</TableHead>
              <TableHead role="columnheader">Status</TableHead>
              <TableHead role="columnheader">Attempts</TableHead>
              <TableHead role="columnheader">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {log.map((l) => (
              <TableRow role="row" key={l.id} className="align-top">
                <TableCell role="cell" data-label="When" className="whitespace-nowrap">{when(l.createdAt)}</TableCell>
                <TableCell role="cell" data-label="Event">{eventLabels[l.event as keyof typeof eventLabels] ?? l.event}</TableCell>
                <TableCell role="cell" data-label="Channel">{l.type ? `${l.type}: ${l.target}` : "removed"}</TableCell>
                <TableCell role="cell" data-label="Status"><StatusBadge status={l.status} /></TableCell>
                <TableCell role="cell" data-label="Attempts">{l.attempts}</TableCell>
                <TableCell role="cell" data-label="Error">{l.error ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
