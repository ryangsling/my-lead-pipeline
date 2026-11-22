"use client";

import type Vapi from "@vapi-ai/web";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Initial = {
  personaName: string;
  firstMessage: string;
  systemPrompt: string;
  knowledge: string;
  voiceId: string;
  model: string;
  maxDurationS: number;
  structuredFields: string[];
};

type Sync = { vapiAssistantId: string | null; syncedAt: string | null; syncError: string | null };
type NumberOption = { id: string; number: string };

export function AgentForm({
  workspaceId,
  publicKey,
  initial,
  sync,
  assigned,
}: {
  workspaceId: string;
  publicKey: string;
  initial: Initial;
  sync: Sync;
  assigned: { id: string; number: string } | null;
}) {
  const [form, setForm] = useState(initial);
  const [structured, setStructured] = useState(initial.structuredFields.join(", "));
  const [message, setMessage] = useState(
    sync.syncError
      ? `Last sync failed: ${sync.syncError}`
      : sync.syncedAt
        ? `Last synced ${new Date(sync.syncedAt).toLocaleString()}`
        : "Not synced yet",
  );
  const [assistantId, setAssistantId] = useState(sync.vapiAssistantId);
  const [numbers, setNumbers] = useState<NumberOption[]>([]);
  const [selected, setSelected] = useState(assigned?.id ?? "");
  const [assignedNumber, setAssignedNumber] = useState(assigned?.number ?? "");
  const [phoneMessage, setPhoneMessage] = useState("");
  const [callState, setCallState] = useState<"idle" | "connecting" | "live">("idle");
  const vapiRef = useRef<Vapi | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/phone-numbers`)
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) {
          setPhoneMessage(body.error ?? "Could not load phone numbers");
          return;
        }
        setNumbers(body.numbers ?? []);
        if (body.assigned) {
          setSelected(body.assigned.id);
          setAssignedNumber(body.assigned.number);
        }
      })
      .catch(() => {
        if (active) setPhoneMessage("Could not load phone numbers");
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function save(): Promise<boolean> {
    const structuredFields = structured
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await fetch(`/api/workspaces/${workspaceId}/assistant`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, structuredFields }),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage(`Not saved: ${body.fields ? JSON.stringify(body.fields) : body.error}`);
      return false;
    }
    setMessage("Saved. Press Sync to Vapi to apply.");
    return true;
  }

  async function syncNow() {
    if (!(await save())) return;
    setMessage("Syncing...");
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/assistant/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.ok) {
        setAssistantId(body.vapiAssistantId);
        setMessage("Synced to Vapi");
      } else {
        setMessage(`Sync failed: ${body.error ?? res.status}`);
      }
    } catch (error) {
      setMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function assignNumber() {
    const chosen = numbers.find((n) => n.id === selected);
    if (!chosen) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/phone-numbers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vapiPhoneNumberId: chosen.id, e164: chosen.number }),
    });
    const body = await res.json();
    if (!res.ok) {
      setPhoneMessage(`Not assigned: ${body.error}`);
      return;
    }
    setAssignedNumber(chosen.number);
    setPhoneMessage(`Assigned ${chosen.number}`);
  }

  async function toggleCall() {
    if (vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current = null;
      setCallState("idle");
      return;
    }
    if (!publicKey || !assistantId) return;
    const { default: VapiClient } = await import("@vapi-ai/web");
    const vapi = new VapiClient(publicKey);
    vapi.on("call-start", () => setCallState("live"));
    vapi.on("call-end", () => {
      vapiRef.current = null;
      setCallState("idle");
    });
    vapi.on("error", (error) => {
      vapiRef.current = null;
      setCallState("idle");
      setMessage(`Call error: ${String(error)}`);
    });
    vapiRef.current = vapi;
    setCallState("connecting");
    try {
      await vapi.start(assistantId);
    } catch (error) {
      vapiRef.current = null;
      setCallState("idle");
      setMessage(`Call error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const callLabel = callState === "live" ? "End call" : callState === "connecting" ? "Connecting..." : "Test in browser";

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="personaName">Persona name</Label>
            <Input id="personaName" value={form.personaName} onChange={(e) => setForm({ ...form, personaName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="firstMessage">Greeting after the AI and recording notice</Label>
            <Textarea id="firstMessage" rows={3} value={form.firstMessage} onChange={(e) => setForm({ ...form, firstMessage: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="voiceId">ElevenLabs voice id</Label>
              <Input id="voiceId" value={form.voiceId} onChange={(e) => setForm({ ...form, voiceId: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="model">Call model (Vapi)</Label>
              <Input id="model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxDurationS">Max call seconds</Label>
            <Input
              id="maxDurationS"
              type="number"
              min={30}
              max={3600}
              value={form.maxDurationS}
              onChange={(e) => setForm({ ...form, maxDurationS: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="systemPrompt">System prompt</Label>
            <Textarea id="systemPrompt" rows={8} value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              Variables: {"{{business_name}}"}, {"{{services}}"}, {"{{hours}}"}, {"{{today}}"}, {"{{timezone}}"}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="knowledge">Knowledge</Label>
            <Textarea id="knowledge" rows={4} value={form.knowledge} onChange={(e) => setForm({ ...form, knowledge: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="structured">Structured fields</Label>
            <Input id="structured" value={structured} onChange={(e) => setStructured(e.target.value)} />
            <p className="text-xs text-muted-foreground">Comma separated. These are extracted from every call.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={save}>Save</Button>
            <Button type="button" variant="outline" onClick={syncNow}>Sync to Vapi</Button>
          </div>
          <p role="status" className="text-sm break-words">{message}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phone number</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select
              aria-label="Vapi phone number"
              className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a number</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>{n.number}</option>
              ))}
            </select>
            <Button type="button" variant="outline" onClick={assignNumber} disabled={!selected}>Assign</Button>
          </div>
          {assignedNumber && <p className="text-sm">Assigned: {assignedNumber}</p>}
          <p role="status" className="text-sm break-words">{phoneMessage}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test in browser</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {!publicKey
              ? "Add the Vapi public key in integrations first."
              : !assistantId
                ? "Sync the agent first."
                : "Starts a web call with this assistant."}
          </p>
          <Button type="button" onClick={toggleCall} disabled={!publicKey || !assistantId}>
            {callLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
