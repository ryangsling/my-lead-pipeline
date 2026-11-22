"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceInput } from "@/lib/workspaces";

const TIMEZONES = Intl.supportedValuesOf("timeZone");
const splitList = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);
const selectClass = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

export const emptyWorkspace: WorkspaceInput = {
  name: "",
  slug: "",
  niche: "",
  country: "GB",
  timezone: "Europe/London",
  phoneDisplay: "",
  vapiMode: "own",
  businessInfo: { hours: "", address: "", serviceArea: "", faq: "", policies: "" },
};

/** Creates a workspace, or edits and archives one when `id` is given. */
export function WorkspaceForm({ initial, id }: { initial: WorkspaceInput; id?: string }) {
  const router = useRouter();
  const [zipText, setZipText] = useState(initial.serviceZips?.join(", ") ?? "");
  const [cityText, setCityText] = useState(initial.serviceCities?.join(", ") ?? "");
  const [v, setV] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const set = (k: keyof WorkspaceInput) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const setInfo = (k: keyof WorkspaceInput["businessInfo"]) => (e: { target: { value: string } }) =>
    setV({ ...v, businessInfo: { ...v.businessInfo, [k]: e.target.value } });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch(id ? `/api/workspaces/${id}` : "/api/workspaces", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...v, serviceZips: splitList(zipText), serviceCities: splitList(cityText) }),
    });
    const body = await res.json();
    if (!res.ok) {
      setFields(body.fields ?? {});
      setMessage(body.error);
      return;
    }
    setFields({});
    setMessage("Saved");
    router.push(`/w/${body.workspace.slug}`);
    router.refresh();
  }

  async function archive() {
    await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const field = (name: string, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      {input}
      {fields[name] && <p className="text-sm text-destructive">{fields[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      {field("name", "Name", <Input id="name" value={v.name} onChange={set("name")} />)}
      {field("slug", "Slug", <Input id="slug" value={v.slug} onChange={set("slug")} />)}
      {field("niche", "Niche", <Input id="niche" value={v.niche} onChange={set("niche")} />)}
      {field("country", "Country (2 letters)", <Input id="country" value={v.country} onChange={set("country")} maxLength={2} />)}
      {field(
        "timezone",
        "Timezone",
        <select id="timezone" value={v.timezone} onChange={set("timezone")} className={selectClass}>
          {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
        </select>,
      )}
      {field("phoneDisplay", "Phone shown to callers", <Input id="phoneDisplay" value={v.phoneDisplay} onChange={set("phoneDisplay")} />)}
      {field(
        "vapiMode",
        "Vapi account",
        <select id="vapiMode" value={v.vapiMode} onChange={set("vapiMode")} className={selectClass}>
          <option value="own">Own account</option>
          <option value="pool">Demo pool</option>
        </select>,
      )}
      <Label><input type="checkbox" checked={v.recordingEnabled ?? true} onChange={(e) => setV({ ...v, recordingEnabled: e.target.checked })} /> Record calls</Label>
      <Label><input type="checkbox" checked={v.transferEnabled ?? false} onChange={(e) => setV({ ...v, transferEnabled: e.target.checked })} /> Enable live transfer</Label>
      <p className="text-sm">Live transfer uses paid outbound minutes.</p>
      {field("callbackMinutes", "Callback minutes", <Input id="callbackMinutes" type="number" min={1} max={120} required value={v.callbackMinutes ?? 15} onChange={(e) => setV({ ...v, callbackMinutes: e.target.valueAsNumber })} />)}
      {field("onCallNumber", "On-call number (international format)", <Input id="onCallNumber" value={v.onCallNumber ?? ""} onChange={set("onCallNumber")} />)}
      {field("backupNumber", "Backup number (international format)", <Input id="backupNumber" value={v.backupNumber ?? ""} onChange={set("backupNumber")} />)}
      {field("escalationTriggers", "Escalation triggers", <Textarea id="escalationTriggers" value={v.escalationTriggers ?? ""} onChange={set("escalationTriggers")} />)}
      {field("serviceZips", "Service ZIP codes (comma separated)", <Input id="serviceZips" value={zipText} onChange={(e) => setZipText(e.target.value)} />)}
      {field("serviceCities", "City exceptions (comma separated)", <Input id="serviceCities" value={cityText} onChange={(e) => setCityText(e.target.value)} />)}
      {field("hours", "Opening hours", <Textarea id="hours" value={v.businessInfo.hours} onChange={setInfo("hours")} />)}
      {field("address", "Address", <Input id="address" value={v.businessInfo.address} onChange={setInfo("address")} />)}
      {field("serviceArea", "Service area", <Input id="serviceArea" value={v.businessInfo.serviceArea} onChange={setInfo("serviceArea")} />)}
      {field("faq", "FAQ", <Textarea id="faq" value={v.businessInfo.faq} onChange={setInfo("faq")} />)}
      {field("policies", "Policies", <Textarea id="policies" value={v.businessInfo.policies} onChange={setInfo("policies")} />)}
      {message && <p role="status" className="text-sm">{message}</p>}
      <div className="flex gap-2">
        <Button type="submit">{id ? "Save" : "Create workspace"}</Button>
        {id && <Button type="button" variant="outline" onClick={archive}>Archive</Button>}
      </div>
    </form>
  );
}
