import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { channelLabel } from "@/lib/crm/format";
import { listContacts } from "@/lib/crm/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";

const select = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export default async function ContactsPage({ params, searchParams }: PageProps<"/w/[slug]/contacts">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const { q = "", source = "" } = (await searchParams) as { q?: string; source?: string };
  const rows = await listContacts(w.id, { q, source });

  return (
    <>
      <h1 className="mb-4 text-xl font-medium">Contacts for {w.name}</h1>
      <form className="mb-4 flex items-center gap-2" method="get">
        <Input name="q" defaultValue={q} placeholder="Search name, phone or email" aria-label="Search" className="max-w-xs" />
        <select name="source" defaultValue={source} aria-label="Source" className={select}>
          <option value="">All sources</option>
          {Object.entries(channelLabel).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <Button type="submit" size="sm">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm">No contacts found.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3">Name</th>
              <th className="pr-3">Phone</th>
              <th className="pr-3">Email</th>
              <th className="pr-3">Source</th>
              <th className="pr-3">Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2 pr-3">
                  <Link href={`/w/${w.slug}/contacts/${c.id}`} className="underline">{c.name ?? "Unnamed"}</Link>
                </td>
                <td className="pr-3">{c.phoneE164 ?? "-"}</td>
                <td className="pr-3">{c.email ?? "-"}</td>
                <td className="pr-3">{c.source ? (channelLabel[c.source] ?? c.source) : "-"}</td>
                <td className="pr-3">{DateTime.fromJSDate(c.createdAt, { zone: w.timezone }).toFormat("d LLL yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
