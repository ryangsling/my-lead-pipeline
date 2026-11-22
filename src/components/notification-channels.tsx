"use client";

import { useState } from "react";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Channel = { id?: string; type: "telegram" | "email"; target: string; events: string[]; active: boolean };
type Event = { value: string; label: string };


export function NotificationChannels({
  workspaceId,
  initial,
  events,
  telegramChatId,
}: {
  workspaceId: string;
  initial: Channel[];
  events: Event[];
  telegramChatId: string;
}) {
  const [list, setList] = useState<Channel[]>(initial);
  const [message, setMessage] = useState("");
  const [tests, setTests] = useState<Record<number, string>>({});

  const change = (index: number, patch: Partial<Channel>) => setList((c) => c.map((ch, i) => (i === index ? { ...ch, ...patch } : ch)));
  const toggle = (index: number, event: string, on: boolean) =>
    change(index, { events: on ? [...list[index].events, event] : list[index].events.filter((e) => e !== event) });

  async function save() {
    setMessage("Saving...");
    const res = await fetch(`/api/workspaces/${workspaceId}/notifications`, { method: "PUT", body: JSON.stringify({ channels: list }) });
    const body = await res.json();
    if (!res.ok) {
      setMessage(((body.fields && Object.values(body.fields)[0]) as string | undefined) ?? body.error ?? "Save failed");
      return;
    }
    setList(body.channels);
    setMessage("Saved");
  }

  async function test(index: number) {
    const id = list[index].id;
    if (!id) return;
    setTests((t) => ({ ...t, [index]: "Sending..." }));
    const res = await fetch("/api/notifications/test", { method: "POST", body: JSON.stringify({ workspaceId, channelId: id }) });
    const body = await res.json();
    setTests((t) => ({ ...t, [index]: res.ok ? "Sent" : `Failed: ${body.error ?? res.status}` }));
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Channels</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {list.length === 0 && <p className="text-sm">No channels yet.</p>}
        {list.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="grid gap-2 rounded border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`type-${i}`}>Type</Label>
                <FormSelect id={`type-${i}`} value={c.type} choices={[{ value: "telegram", label: "Telegram" }, { value: "email", label: "Email" }]}
                  onChange={(value) => change(i, { type: value === "email" ? "email" : "telegram" })} />
              </div>
              <div className="grid flex-1 gap-1">
                <Label htmlFor={`target-${i}`}>{c.type === "telegram" ? "Telegram chat id" : "Email address"}</Label>
                <Input id={`target-${i}`} value={c.target} onChange={(e) => change(i, { target: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pb-1 text-sm">
                <input type="checkbox" checked={c.active} onChange={(e) => change(i, { active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              {events.map((e) => (
                <label key={e.value} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={c.events.includes(e.value)} onChange={(ev) => toggle(i, e.value, ev.target.checked)} />
                  {e.label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={!c.id} onClick={() => test(i)}>Send test</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setList((l) => l.filter((_, n) => n !== i))}>Remove</Button>
              {!c.id && <span className="text-sm">Save first to send a test.</span>}
              {tests[i] && <span className="text-sm">{tests[i]}</span>}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setList((l) => [...l, {
              type: "telegram", target: telegramChatId,
              events: events.filter((e) => e.value !== "urgent_callback_escalation").map((e) => e.value), active: true,
            }])}
          >
            Add channel
          </Button>
          <Button type="button" size="sm" onClick={save}>Save channels</Button>
          {message && <span className="text-sm">{message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
