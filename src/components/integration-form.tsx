"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { providers, type Provider } from "@/lib/integrations/providers";

type View = {
  saved: boolean;
  credentials: Record<string, string>;
  config: Record<string, string>;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
};

const words = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** One provider's keys. `workspaceId` makes it a per-workspace override of the global row. */
export function IntegrationForm({ provider, workspaceId, initial }: { provider: Provider; workspaceId?: string; initial: View }) {
  const router = useRouter();
  const spec = providers[provider];
  const [creds, setCreds] = useState<Record<string, string>>(initial.credentials);
  const [config, setConfig] = useState<Record<string, string>>(initial.config);
  const [message, setMessage] = useState(
    initial.status === "ok" ? "Last test passed" : initial.lastError ? `Last test failed: ${initial.lastError}` : "",
  );
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);

  const url = (extra = "") => `/api/integrations/${provider}${extra}${workspaceId ? `?workspaceId=${workspaceId}` : ""}`;

  async function save() {
    const res = await fetch(url(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials: creds, config }),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage(`Not saved: ${JSON.stringify(body.fields ?? body.error)}`);
      return false;
    }
    setCreds(body.credentials);
    setConfig(body.config);
    setMessage("Saved");
    router.refresh();
    return true;
  }

  async function test() {
    if (!(await save())) return;
    setMessage("Testing...");
    const res = await fetch(url("/test"), { method: "POST" });
    const body = await res.json();
    setMessage(body.ok ? "Test passed" : `Test failed: ${body.error}`);
  }

  async function findChats() {
    const res = await fetch("/api/integrations/telegram/chats");
    const body = await res.json();
    if (!res.ok) return setMessage(body.error);
    setChats(body.chats);
    setMessage(body.chats.length ? "" : "No chats yet. Press Start in your bot, then try again.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{spec.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {spec.secrets.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`${provider}-${k}`}>{words(k)}</Label>
            <Input id={`${provider}-${k}`} type="password" autoComplete="off" value={creds[k] ?? ""} onChange={(e) => setCreds({ ...creds, [k]: e.target.value })} />
          </div>
        ))}
        {spec.config.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`${provider}-${k}`}>{words(k)}</Label>
            <Input id={`${provider}-${k}`} value={config[k] ?? ""} onChange={(e) => setConfig({ ...config, [k]: e.target.value })} />
          </div>
        ))}
        {provider === "telegram" && (
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={findChats}>Find my chat id</Button>
            {chats.map((c) => (
              <button key={c.id} type="button" className="block text-sm underline" onClick={() => setConfig({ ...config, chatId: c.id })}>
                {c.name || "Chat"} ({c.id})
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" onClick={save}>Save</Button>
          <Button type="button" variant="outline" onClick={test}>Test connection</Button>
        </div>
        {message && <p role="status" className="text-sm break-words">{message}</p>}
      </CardContent>
    </Card>
  );
}
