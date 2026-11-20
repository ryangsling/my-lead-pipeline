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
      <h1 className="mb-4 text-xl font-medium">Appointments for {w.name}</h1>
      <p className="mb-3 text-sm">Times are in {w.timezone}.</p>
      {rows.length === 0 ? (
        <p className="text-sm">No appointments yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3">When</th>
              <th className="pr-3">Service</th>
              <th className="pr-3">Contact</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 pr-3">{when(r.startAt)}</td>
                <td className="pr-3">{r.service ?? "-"}</td>
                <td className="pr-3">{[r.contactName, r.contactPhone].filter(Boolean).join(" ") || "-"}</td>
                <td className="pr-3">{r.status}</td>
                <td className="pr-3">{r.source}</td>
                <td>
                  <AppointmentActions workspaceId={w.id} id={r.id} status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
