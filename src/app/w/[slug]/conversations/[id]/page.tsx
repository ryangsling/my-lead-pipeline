import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { channelLabel, duration, money } from "@/lib/crm/format";
import { getConversationJob } from "@/lib/crm/jobs";
import { getConversation } from "@/lib/crm/list";
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
  const job = await getConversationJob(w.id, c.id);
  const jobFields = job ? [
    ["Site", [job.address, job.city, job.zip].filter(Boolean).join(", ")],
    ["Job type", job.jobType], ["Problem", job.problem], ["Urgency", job.urgency],
    ["Callback window", job.callbackWindow && `${job.callbackWindow} (${job.timezone})`], ["Lead source", job.leadSource],
  ].filter(([, value]) => value) : [];
  const started = c.startedAt ?? c.createdAt;
  const recording = `/api/conversations/${c.id}/recording?workspaceId=${w.id}`;
  const fields = Object.entries(c.structured as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null);

  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/w/${w.slug}/conversations`} className="underline">All conversations</Link></p>
      <h1 className="mb-2 text-xl font-medium">
        {channelLabel[c.channel] ?? c.channel} on {DateTime.fromJSDate(started, { zone: w.timezone }).toFormat("ccc d LLL yyyy, HH:mm")}
      </h1>
      <dl className="mb-6 grid max-w-md grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt>Contact</dt>
        <dd>
          {contact ? (
            <Link href={`/w/${w.slug}/contacts/${contact.id}`} className="underline">
              {[contact.name, contact.phoneE164].filter(Boolean).join(" ") || "Unnamed"}
            </Link>
          ) : (
            "-"
          )}
        </dd>
        <dt>Length</dt><dd>{duration(c.durationS)}</dd>
        <dt>Cost</dt><dd>{money(c.costUsd)}</dd>
        <dt>Outcome</dt><dd>{c.outcome ?? "-"}</dd>
      </dl>

      <h2 className="mb-2 font-medium">Summary</h2>
      <p className="mb-6 max-w-2xl text-sm">{c.summary ?? "No summary."}</p>

      {c.recordingUrl && (
        <>
          <h2 className="mb-2 font-medium">Recording</h2>
          <audio controls preload="none" src={recording} className="mb-1 w-full max-w-md" />
          <p className="mb-6 text-sm"><a href={recording} className="underline">Open recording</a></p>
        </>
      )}

      {jobFields.length > 0 && <section className="mb-6">
        <h2 className="mb-2 font-medium">Job details</h2>
        <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-1 text-sm">
          {jobFields.map(([label, value]) => <div className="contents" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>}
      <h2 className="mb-2 font-medium">Call fields</h2>
      {fields.length === 0 ? (
        <p className="mb-6 text-sm">Nothing captured.</p>
      ) : (
        <dl className="mb-6 grid max-w-md grid-cols-[10rem_1fr] gap-y-1 text-sm">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt>{key}</dt>
              <dd>{shown(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <h2 className="mb-2 font-medium">Transcript and tool calls</h2>
      {messages.length === 0 ? (
        <p className="text-sm">No transcript.</p>
      ) : (
        <ol className="grid max-w-2xl gap-2 text-sm">
          {messages.map((m) => (
            <li key={m.id} className={m.role.startsWith("tool") ? "rounded border px-2 py-1" : undefined}>
              {m.role === "tool_call" && <><strong>Tool call {m.toolName}:</strong> {m.content}</>}
              {m.role === "tool_result" && <><strong>Result of {m.toolName}:</strong> {m.content}</>}
              {!m.role.startsWith("tool") && <><strong>{c.channel === "chat" && m.role === "user" ? "Visitor" : speaker[m.role] ?? m.role}:</strong> {m.content}</>}
              {c.channel === "chat" && m.providerName && <p className="text-xs text-muted-foreground">{m.providerName} · {m.providerModel}</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
