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
      <h1 className="mb-4 text-xl font-medium">Conversations for {w.name}</h1>
      <p className="mb-3 text-sm">Times are in {w.timezone}.</p>
      {rows.length === 0 ? (
        <p className="text-sm">No conversations yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3">When</th>
              <th className="pr-3">Channel</th>
              <th className="pr-3">Contact</th>
              <th className="pr-3">Length</th>
              <th className="pr-3">Cost</th>
              <th className="pr-3">Outcome</th>
              <th className="pr-3">Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <Link href={`/w/${w.slug}/conversations/${c.id}`} className="underline">
                    {DateTime.fromJSDate(c.startedAt ?? c.createdAt, { zone: w.timezone }).toFormat("d LLL, HH:mm")}
                  </Link>
                </td>
                <td className="pr-3">{channelLabel[c.channel] ?? c.channel}</td>
                <td className="pr-3">{[c.contactName, c.contactPhone].filter(Boolean).join(" ") || "-"}</td>
                <td className="pr-3">{duration(c.durationS)}</td>
                <td className="pr-3">{money(c.costUsd)}</td>
                <td className="pr-3">{c.outcome ?? "-"}</td>
                <td className="pr-3">{c.summary ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
