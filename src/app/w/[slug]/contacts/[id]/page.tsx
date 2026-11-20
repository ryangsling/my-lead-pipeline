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
      <h1 className="mb-2 text-xl font-medium">{contact.name ?? "Unnamed contact"}</h1>
      <dl className="mb-6 grid max-w-md grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt>Phone</dt><dd>{contact.phoneE164 ?? "-"}</dd>
        <dt>Email</dt><dd>{contact.email ?? "-"}</dd>
        <dt>Source</dt><dd>{contact.source ? (channelLabel[contact.source] ?? contact.source) : "-"}</dd>
        <dt>Notes</dt><dd>{contact.notes ?? "-"}</dd>
      </dl>

      <h2 className="mb-2 font-medium">Conversations</h2>
      {conversations.length === 0 ? (
        <p className="mb-6 text-sm">None yet.</p>
      ) : (
        <ul className="mb-6 grid gap-1 text-sm">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/w/${w.slug}/conversations/${c.id}`} className="underline">
                {when(c.startedAt ?? c.createdAt)}
              </Link>{" "}
              {channelLabel[c.channel] ?? c.channel}, {duration(c.durationS)}, {c.outcome ?? "no outcome"}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 font-medium">Appointments</h2>
      {appointments.length === 0 ? (
        <p className="text-sm">None yet.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {appointments.map((a) => (
            <li key={a.id}>{when(a.startAt)}, {a.service ?? "no service"}, {a.status}</li>
          ))}
        </ul>
      )}
    </>
  );
}
