"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatProviderView } from "@/lib/chat/providers";

type Draft = Pick<ChatProviderView, "name" | "baseUrl" | "model" | "timeoutMs" | "enabled" | "toolCapable" | "testedAt" | "testPassed" | "cooldownUntil">
  & { id?: string; localId: string; apiKey: string };
const draft = (provider: ChatProviderView): Draft => ({ ...provider, localId: provider.id, apiKey: "" });

export function ProviderChainForm({ workspaceId, initial }: { workspaceId: string | null; initial: ChatProviderView[] }) {
  const [rows, setRows] = useState(() => initial.map(draft));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const path = "/api/integrations/chat-providers";
  const query = workspaceId ? `?workspaceId=${workspaceId}` : "";
  const update = (next: Draft[]) => { setRows(next); setDirty(true); setStatus(""); };
  const patch = (index: number, changes: Partial<Draft>) => update(rows.map((row, i) => i === index ? { ...row, ...changes } : row));

  function move(index: number, offset: number) {
    const next = [...rows];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const body = rows.map(({ id, name, baseUrl, model, timeoutMs, enabled, toolCapable, apiKey }) => ({
        id, name, baseUrl, model, timeoutMs, enabled, toolCapable, apiKey: apiKey || undefined,
      }));
      const response = await fetch(path + query, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error ?? "Could not save the provider chain.");
        return;
      }
      setRows((data.providers as ChatProviderView[]).map(draft));
      setDirty(false);
      setStatus("Provider chain saved.");
    } catch {
      setStatus("Could not save the provider chain.");
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setBusy(true);
    setStatus("Testing tool support…");
    try {
      const response = await fetch(`${path}/${id}/test${query}`, { method: "POST" });
      if (!response.ok) throw new Error("Test unavailable");
      const { passed } = await response.json();
      setRows(current => current.map(row => row.id === id ? { ...row, testedAt: new Date(), testPassed: passed } : row));
      setStatus(passed ? "Tool call passed." : "Tool call failed. Check the provider settings and model support.");
    } catch {
      setStatus("Could not run the provider test.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} autoComplete="off" className="space-y-4">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No providers configured here.</p>}
      {rows.map((row, index) => {
        const id = row.localId;
        return (
          <fieldset disabled={busy} key={id} className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">{row.name || `Provider ${index + 1}`}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} value={row.name} required maxLength={80} onChange={e => patch(index, { name: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor={`${id}-model`}>Model ID</Label>
                <Input id={`${id}-model`} value={row.model} required maxLength={200} onChange={e => patch(index, { model: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor={`${id}-url`}>OpenAI-compatible base URL</Label>
                <Input id={`${id}-url`} value={row.baseUrl} type="url" required placeholder="https://openrouter.ai/api/v1" onChange={e => patch(index, { baseUrl: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor={`${id}-timeout`}>Timeout (milliseconds)</Label>
                <Input id={`${id}-timeout`} value={row.timeoutMs || ""} type="number" required min={100} max={30_000} onChange={e => patch(index, { timeoutMs: Number(e.target.value) })} /></div>
              <div className="space-y-2"><Label htmlFor={`${id}-key`}>API key</Label>
                <Input id={`${id}-key`} value={row.apiKey} type="password" autoComplete="new-password" required={!row.id} maxLength={4096} placeholder={row.id ? "Enter a replacement key" : undefined} onChange={e => patch(index, { apiKey: e.target.value })} /></div>
              <div className="flex flex-wrap items-end gap-4 pb-2">
                <Label><input type="checkbox" checked={row.enabled} onChange={e => patch(index, { enabled: e.target.checked })} />Enabled</Label>
                <Label><input type="checkbox" checked={row.toolCapable} onChange={e => patch(index, { toolCapable: e.target.checked })} />Tool-capable</Label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => move(index, -1)}>Move up</Button>
              <Button type="button" size="sm" variant="outline" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>Move down</Button>
              <Button type="button" size="sm" variant="outline" disabled={!row.id || dirty || !row.toolCapable} onClick={() => row.id && void test(row.id)}>Test</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => update(rows.filter((_, i) => i !== index))}>Remove</Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {row.testedAt ? `Last tool test ${row.testPassed ? "passed" : "failed"}.` : "Tool support has not been tested."}
              {row.cooldownUntil && ` Rate limit resets at ${new Date(row.cooldownUntil).toISOString().slice(0, 16).replace("T", " ")} UTC.`}
            </p>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={rows.length >= 5 || busy} onClick={() => update([...rows, {
          localId: crypto.randomUUID(), name: "", baseUrl: "", model: "", timeoutMs: 8000, apiKey: "",
          enabled: true, toolCapable: false, testedAt: null, testPassed: null, cooldownUntil: null,
        }])}>Add provider</Button>
        <Button type="submit" disabled={!dirty || busy}>Save chain</Button>
      </div>
      <p role="status" className="text-sm">{status}</p>
    </form>
  );
}
