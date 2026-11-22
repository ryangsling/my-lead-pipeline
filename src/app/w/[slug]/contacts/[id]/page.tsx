import { EmptyState, StatusBadge } from "@/components/admin-display";
import { ContactDelete } from "@/components/contact-delete";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { channelLabel, duration } from "@/lib/crm/format";
import { getContact } from "@/lib/crm/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function ContactPage({ params }: PageProps<"/w/[slug]/contacts/[id]">) {
  const { slug, id } = await params;
  const w = await getWorkspaceBySlug(slug);
  if (!w) notFound();
  const found = await getContact(w.id, id);
  if (!found) notFound();
  const { contact, conversations, appointments } = found;
  const when = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: w.timezone }).toFormat("ccc d LLL yyyy, HH:mm") : "-");

  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/w/${w.slug}/contacts`} className="underline">All contacts</Link></p>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-medium">{contact.name ?? "Unnamed contact"}</h1>
        <ContactDelete workspaceId={w.id} contactId={contact.id} slug={w.slug} />
      </div>
      <dl className="mb-6 grid max-w-md grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt>Phone</dt><dd>{contact.phoneE164 ?? "-"}</dd>
        <dt>Email</dt><dd>{contact.email ?? "-"}</dd>
        <dt>Source</dt><dd>{contact.source ? (channelLabel[contact.source] ?? contact.source) : "-"}</dd>
        <dt>Notes</dt><dd>{contact.notes ?? "-"}</dd>
      </dl>

      <h2 className="mb-3 font-medium">Conversations</h2>
      <div className="mb-6">
        {conversations.length ? <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Channel</TableHead><TableHead>Length</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader>
          <TableBody>{conversations.map((c) => <TableRow key={c.id}>
            <TableCell><Link href={`/w/${w.slug}/conversations/${c.id}`} className="underline">{when(c.startedAt ?? c.createdAt)}</Link></TableCell>
            <TableCell>{channelLabel[c.channel] ?? c.channel}</TableCell>
            <TableCell>{duration(c.durationS)}</TableCell><TableCell><StatusBadge status={c.outcome} /></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <EmptyState>No conversations yet.</EmptyState>}
      </div>

      <h2 className="mb-3 font-medium">Appointments</h2>
      {appointments.length ? <Table>
        <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>{appointments.map((a) => <TableRow key={a.id}>
          <TableCell>{when(a.startAt)}</TableCell><TableCell>{a.service ?? "—"}</TableCell>
          <TableCell><StatusBadge status={a.status} /></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <EmptyState>No appointments yet.</EmptyState>}
    </>
  );
}
