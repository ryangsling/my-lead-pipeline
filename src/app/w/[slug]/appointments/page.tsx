import { EmptyState, StatusBadge } from "@/components/admin-display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { AppointmentActions } from "@/components/appointment-actions";
import { listAppointments } from "@/lib/booking/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function AppointmentsPage({ params }: PageProps<"/w/[slug]/appointments">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const rows = await listAppointments(w.id);
  const when = (d: Date) => DateTime.fromJSDate(d, { zone: w.timezone }).toFormat("ccc d LLL yyyy, HH:mm");

  return (
    <>
      <h1 className="mb-3">Appointments</h1>
      <p className="mb-3 text-sm">Times are in {w.timezone}.</p>
      {rows.length === 0 ? (
        <EmptyState>No appointments yet.</EmptyState>
      ) : (
        <Table role="table" className="responsive-table text-left">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead role="columnheader">When</TableHead>
              <TableHead role="columnheader">Service</TableHead>
              <TableHead role="columnheader">Contact</TableHead>
              <TableHead role="columnheader">Status</TableHead>
              <TableHead role="columnheader">Source</TableHead>
              <TableHead role="columnheader">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {rows.map((r) => (
              <TableRow role="row" key={r.id}>
                <TableCell role="cell" data-label="When">{when(r.startAt)}</TableCell>
                <TableCell role="cell" data-label="Service">{r.service ?? "-"}</TableCell>
                <TableCell role="cell" data-label="Contact">{[r.contactName, r.contactPhone].filter(Boolean).join(" ") || "-"}</TableCell>
                <TableCell role="cell" data-label="Status"><StatusBadge status={r.status} /></TableCell>
                <TableCell role="cell" data-label="Source">{r.source}</TableCell>
                <TableCell role="cell" data-label="Actions">
                  <AppointmentActions workspaceId={w.id} id={r.id} status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
