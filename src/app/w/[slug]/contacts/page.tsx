import { FormSelect } from "@/components/form-select";
import { EmptyState } from "@/components/admin-display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { channelLabel } from "@/lib/crm/format";
import { listContacts } from "@/lib/crm/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";


export default async function ContactsPage({ params, searchParams }: PageProps<"/w/[slug]/contacts">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const { q = "", source = "" } = (await searchParams) as { q?: string; source?: string };
  const rows = await listContacts(w.id, { q, source });

  return (
    <>
      <h1 className="mb-3">Contacts</h1>
      <form className="mb-4 flex flex-wrap items-center gap-3" method="get">
        <Input name="q" defaultValue={q} placeholder="Search name, phone or email" aria-label="Search" className="max-w-xs" />
        <div className="w-40"><FormSelect name="source" label="Source" value={source} choices={[
          { value: "", label: "All sources" }, ...Object.entries(channelLabel).map(([value, label]) => ({ value, label })),
        ]} /></div>
        <Button type="submit" size="sm">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState>No contacts found.</EmptyState>
      ) : (
        <Table role="table" className="responsive-table text-left">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead role="columnheader">Name</TableHead>
              <TableHead role="columnheader">Phone</TableHead>
              <TableHead role="columnheader">Email</TableHead>
              <TableHead role="columnheader">Source</TableHead>
              <TableHead role="columnheader">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {rows.map((c) => (
              <TableRow role="row" key={c.id}>
                <TableCell role="cell" data-label="Name">
                  <Link href={`/w/${w.slug}/contacts/${c.id}`} className="underline">{c.name ?? "Unnamed"}</Link>
                </TableCell>
                <TableCell role="cell" data-label="Phone">{c.phoneE164 ?? "-"}</TableCell>
                <TableCell role="cell" data-label="Email">{c.email ?? "-"}</TableCell>
                <TableCell role="cell" data-label="Source">{c.source ? (channelLabel[c.source] ?? c.source) : "-"}</TableCell>
                <TableCell role="cell" data-label="Added">{DateTime.fromJSDate(c.createdAt, { zone: w.timezone }).toFormat("d LLL yyyy")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
