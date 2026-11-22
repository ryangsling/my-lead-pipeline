import { DateTime } from "luxon";
import { ArrowUpRight, CalendarDays, MessagesSquare, Settings2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/admin-display";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAppointments } from "@/lib/booking/list";
import { channelLabel } from "@/lib/crm/format";
import { listConversations } from "@/lib/crm/list";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function WorkspacePage({ params }: PageProps<"/w/[slug]">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const [talks, bookings] = await Promise.all([listConversations(w.id, 5), listAppointments(w.id, 5)]);
  const base = `/w/${w.slug}`;
  const when = (date: Date) => DateTime.fromJSDate(date, { zone: w.timezone }).toFormat("ccc d LLL, HH:mm");

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Dashboard</h1>
          <p className="mt-2 text-muted-foreground">{w.name} · {w.timezone.replaceAll("_", " ")}</p>
        </div>
        <Link href={`${base}/settings`} className={buttonVariants({ variant: "outline", className: "admin-button gap-2" })}>
          <Settings2 /> Workspace settings
        </Link>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessagesSquare className="size-4 text-[var(--status-info)]" /> Recent conversations</CardTitle>
          </CardHeader>
          <CardContent>
            {talks.length ? <ul className="divide-y">
              {talks.map((item) => <li key={item.id} className="py-3">
                <Link href={`${base}/conversations/${item.id}`} className="flex min-h-10 items-center justify-between gap-3 rounded-lg hover:underline">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.contactName || channelLabel[item.channel] || item.channel}</span>
                    <span className="block text-muted-foreground">{when(item.startedAt ?? item.createdAt)}</span>
                  </span>
                  <StatusBadge status={item.outcome} />
                </Link>
              </li>)}
            </ul> : <p className="py-3 text-muted-foreground">No conversations yet.</p>}
            <Link className="mt-3 inline-flex min-h-10 items-center gap-2 underline-offset-4 hover:underline" href={`${base}/conversations`}>All conversations <ArrowUpRight className="size-4" /></Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-[var(--status-info)]" /> Recent appointments</CardTitle>
          </CardHeader>
          <CardContent>
            {bookings.length ? <ul className="divide-y">
              {bookings.map((item) => <li key={item.id} className="flex min-h-16 items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{item.service || "Appointment"}</p>
                  <p className="text-muted-foreground">{when(item.startAt)}</p>
                </div>
                <StatusBadge status={item.status} />
              </li>)}
            </ul> : <p className="py-3 text-muted-foreground">No appointments yet.</p>}
            <Link className="mt-3 inline-flex min-h-10 items-center gap-2 underline-offset-4 hover:underline" href={`${base}/appointments`}>All appointments <ArrowUpRight className="size-4" /></Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
