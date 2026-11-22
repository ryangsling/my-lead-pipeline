import { EmptyState, StatusBadge } from "@/components/admin-display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { channelLabel, duration, money } from "@/lib/crm/format";
import { listConversations } from "@/lib/crm/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function ConversationsPage({ params }: PageProps<"/w/[slug]/conversations">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const rows = await listConversations(w.id);

  return (
    <>
      <h1 className="mb-3">Conversations</h1>
      <p className="mb-3 text-sm">Times are in {w.timezone}.</p>
      {rows.length === 0 ? (
        <EmptyState>No conversations yet.</EmptyState>
      ) : (
        <Table role="table" className="responsive-table text-left">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead role="columnheader">When</TableHead>
              <TableHead role="columnheader">Channel</TableHead>
              <TableHead role="columnheader">Contact</TableHead>
              <TableHead role="columnheader">Length</TableHead>
              <TableHead role="columnheader">Cost</TableHead>
              <TableHead role="columnheader">Outcome</TableHead>
              <TableHead role="columnheader">Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {rows.map((c) => (
              <TableRow role="row" key={c.id} className="align-top">
                <TableCell role="cell" data-label="When" className="whitespace-nowrap">
                  <Link href={`/w/${w.slug}/conversations/${c.id}`} className="underline">
                    {DateTime.fromJSDate(c.startedAt ?? c.createdAt, { zone: w.timezone }).toFormat("d LLL, HH:mm")}
                  </Link>
                </TableCell>
                <TableCell role="cell" data-label="Channel">{channelLabel[c.channel] ?? c.channel}</TableCell>
                <TableCell role="cell" data-label="Contact">{[c.contactName, c.contactPhone].filter(Boolean).join(" ") || "-"}</TableCell>
                <TableCell role="cell" data-label="Length">{duration(c.durationS)}</TableCell>
                <TableCell role="cell" data-label="Cost">{money(c.costUsd)}</TableCell>
                <TableCell role="cell" data-label="Outcome"><StatusBadge status={c.outcome} /></TableCell>
                <TableCell role="cell" data-label="Summary" className="min-w-60 max-w-sm whitespace-normal">{c.summary ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
