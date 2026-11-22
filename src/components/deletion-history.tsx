import { DateTime } from "luxon";
import Link from "next/link";
import { EmptyState } from "@/components/admin-display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listDeletions } from "@/lib/privacy/audit";

const kinds = { local: "Hub records", vapi: "Vapi call and media", google: "Google event details" };
const statuses = { pending: "Queued", processing: "In progress", retryable: "Retry scheduled", verified: "Verified", manual: "Needs review" };

export async function DeletionHistory({ workspaceId, timezone, requestId }: { workspaceId: string; timezone: string; requestId?: string }) {
  const deletions = await listDeletions(workspaceId, requestId);
  const when = (date: Date) => DateTime.fromJSDate(date, { zone: timezone }).toFormat("d LLL yyyy, HH:mm");
  return (
    <section id="data-deletions" className="mt-8 scroll-mt-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-medium">Data deletion history</h2>
        {requestId && <Link href="./settings#data-deletions" className="text-sm underline">View recent deletions</Link>}
      </div>
      {deletions.length ? <Table>
        <TableHeader>
          <TableRow><TableHead>Scope</TableHead><TableHead>Requested</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead></TableRow>
        </TableHeader>
        <TableBody>{deletions.map(row => <TableRow key={row.id}>
          <TableCell>{kinds[row.kind]}</TableCell>
          <TableCell>{when(row.createdAt)}<br />{row.reason === "retention" ? "Retention" : "Contact deletion"}</TableCell>
          <TableCell>
            {statuses[row.status]}
            {row.verifiedAt && <div>{when(row.verifiedAt)}</div>}
            {row.nextAttemptAt && <div>{when(row.nextAttemptAt)}</div>}
            {row.errorCode && <div className="text-xs text-muted-foreground">{row.errorCode.replaceAll("_", " ")}</div>}
          </TableCell>
          <TableCell className="font-mono text-xs">{row.requestId ?? row.id}</TableCell>
        </TableRow>)}</TableBody>
      </Table> : <EmptyState>No deletions recorded yet.</EmptyState>}
    </section>
  );
}
