import { ArrowLeft, Bot, UserRound } from "lucide-react";
import { StatusBadge, statusLabel } from "@/components/admin-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { channelLabel, duration, money } from "@/lib/crm/format";
import { getConversationJob } from "@/lib/crm/jobs";
import { getConversation } from "@/lib/crm/list";
import { acknowledgeUrgent, getUrgentEvent } from "@/lib/notifications/urgent";
import { getWorkspaceBySlug } from "@/lib/workspaces";

const speaker: Record<string, string> = { user: "Caller", assistant: "Agent" };
const shown = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

export default async function ConversationPage({ params }: PageProps<"/w/[slug]/conversations/[id]">) {
  const { slug, id } = await params;
  const w = await getWorkspaceBySlug(slug);
  if (!w) notFound();
  const found = await getConversation(w.id, id);
  if (!found) notFound();
  const { conversation: c, contact, messages } = found;
  const [job, urgent] = await Promise.all([getConversationJob(w.id, c.id), getUrgentEvent(w.id, c.id)]);
  const workspaceId = w.id;
  const conversationId = c.id;
  async function acknowledge() {
    "use server";
    await requireAdmin();
    await acknowledgeUrgent(workspaceId, conversationId);
    revalidatePath(`/w/${slug}/conversations/${conversationId}`);
  }
  const jobFields = job ? [
    ["Site", [job.address, job.city, job.zip].filter(Boolean).join(", ")],
    ["Job type", job.jobType], ["Problem", job.problem], ["Urgency", job.urgency],
    ["Callback window", job.callbackWindow && `${job.callbackWindow} (${job.timezone})`], ["Lead source", job.leadSource],
  ].filter(([, value]) => value) : [];
  const started = c.startedAt ?? c.createdAt;
  const recording = `/api/conversations/${c.id}/recording?workspaceId=${w.id}`;
  const fields = Object.entries(c.structured as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null);

  return (
    <div className="space-y-5">
      <Link href={`/w/${w.slug}/conversations`} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All conversations
      </Link>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="page-accent">{channelLabel[c.channel] ?? c.channel} conversation</h1>
              <p className="mt-2 text-muted-foreground">
                {DateTime.fromJSDate(started, { zone: w.timezone }).toFormat("ccc d LLL yyyy, HH:mm")}
              </p>
            </div>
            <StatusBadge status={c.outcome} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="col-span-2 sm:col-span-1"><dt className="text-muted-foreground">Contact</dt>
              <dd>{contact ? <Link href={`/w/${w.slug}/contacts/${contact.id}`} className="underline underline-offset-4">
                {[contact.name, contact.phoneE164].filter(Boolean).join(" ") || "Unnamed"}
              </Link> : "—"}</dd>
            </div>
            <div><dt className="text-muted-foreground">Length</dt><dd>{duration(c.durationS)}</dd></div>
            <div><dt className="text-muted-foreground">Cost</dt><dd>{money(c.costUsd)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      {urgent && <Card>
        <CardHeader><h2 className="text-base font-medium">Urgent callback</h2></CardHeader>
        <CardContent className="space-y-3">
          <p>{urgent.acknowledgedAt ? "Acknowledged" : "Awaiting acknowledgement"}</p>
          {urgent.deadlineMissedAt && <p>{urgent.escalatedAt ? "Backup alert queued" : "Acknowledgement deadline missed"}</p>}
          {!urgent.acknowledgedAt && <form action={acknowledge}>
            <Button type="submit" size="sm">Acknowledge callback</Button>
          </form>}
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><h2 className="text-base font-medium">Summary</h2></CardHeader>
        <CardContent className="space-y-4 text-[var(--text-body)]">
          <p className="max-w-3xl">{c.summary ?? "No summary."}</p>
          {c.recordingConsentAt && c.recordingUrl && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-medium text-foreground">Recording</h3>
              <audio aria-label="Call recording" controls preload="none" src={recording} className="w-full max-w-md" />
              <a href={recording} className="underline underline-offset-4">Open recording</a>
            </div>
          )}
        </CardContent>
      </Card>

      {jobFields.length > 0 && <Card>
        <CardHeader><h2 className="text-base font-medium">Job details</h2></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            {jobFields.map(([label, value]) => <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt><dd className="wrap-break-word">{value}</dd>
            </div>)}
          </dl>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><h2 className="text-base font-medium">Call fields</h2></CardHeader>
        <CardContent>
          {fields.length ? <dl className="grid grid-cols-2 gap-4">
            {fields.map(([key, value]) => <div key={key} className="min-w-0">
              <dt className="wrap-break-word text-muted-foreground">{statusLabel(key)}</dt>
              <dd className="wrap-break-word">{shown(value)}</dd>
            </div>)}
          </dl> : <p className="text-muted-foreground">Nothing captured.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-base font-medium">Transcript and tool calls</h2></CardHeader>
        <CardContent>
          {messages.length ? <ol className="grid min-w-0 gap-4">
            {messages.map((message) => {
              const isTool = message.role.startsWith("tool");
              const caller = message.role === "user";
              const Icon = caller ? UserRound : Bot;
              const name = isTool ? (message.role === "tool_call" ? "Tool call" : "Result of") + " " + message.toolName : caller && c.channel === "chat" ? "Visitor" : speaker[message.role] ?? message.role;
              return (
                <li key={message.id} className={isTool ? "w-full min-w-0 rounded-[16px] border bg-muted p-3 text-muted-foreground" :
                  `w-fit max-w-[90%] min-w-0 rounded-[16px] border p-4 ${caller ? "justify-self-end border-[#364a7e] bg-[#18264b]" : "justify-self-start bg-muted"}`}>
                  <p className="mb-1 flex items-center gap-2 font-medium text-foreground">{!isTool && <Icon className="size-4" />}{name}:</p>
                  <p className="whitespace-pre-wrap wrap-anywhere">{message.content}</p>
                  {c.channel === "chat" && message.providerName && <p className="mt-1 text-xs text-muted-foreground">{message.providerName} · {message.providerModel}</p>}
                </li>
              );
            })}
          </ol> : <p className="text-muted-foreground">No transcript.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
