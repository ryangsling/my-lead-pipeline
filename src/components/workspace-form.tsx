"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormSelect } from "@/components/form-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceInput } from "@/lib/workspaces";

const timezones = Intl.supportedValuesOf("timeZone").map((value) => ({ value, label: value.replaceAll("_", " ") }));
const splitList = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);

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
export function WorkspaceForm({ initial, id, recordingApproved = false }: { initial: WorkspaceInput; id?: string; recordingApproved?: boolean }) {
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
    router.push(`/w/${body.workspace.slug}${id ? "/settings" : ""}`);
    router.refresh();
  }

  async function archive() {
    await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const field = (name: string, label: string, input: React.ReactNode) => (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={name}>{label}</Label>
      {input}
      {fields[name] && <p className="text-sm text-destructive">{fields[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-5">
      <Tabs defaultValue="general" className="gap-5">
        <TabsList aria-label="Workspace settings">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="voice">Calls</TabsTrigger>
          <TabsTrigger value="business">Business info</TabsTrigger>
        </TabsList>
        <TabsContent value="general" keepMounted>
          <Card>
            <CardHeader><CardTitle>Workspace and booking brand</CardTitle></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              {field("name", "Name", <Input id="name" value={v.name} onChange={set("name")} />)}
              {field("slug", "Slug", <Input id="slug" value={v.slug} onChange={set("slug")} />)}
              {field("niche", "Niche", <Input id="niche" value={v.niche} onChange={set("niche")} />)}
              {field("country", "Country (2 letters)", <Input id="country" value={v.country} onChange={set("country")} maxLength={2} />)}
              {field(
                "timezone",
                "Timezone",
                <FormSelect id="timezone" value={v.timezone} choices={timezones} onChange={(timezone) => setV({ ...v, timezone })} />,
              )}
              {field("phoneDisplay", "Phone shown to callers", <Input id="phoneDisplay" value={v.phoneDisplay} onChange={set("phoneDisplay")} />)}
              {field("logoUrl", "Logo URL (optional)", <Input id="logoUrl" type="url" placeholder="https://example.com/logo.png" value={v.logoUrl ?? ""} onChange={set("logoUrl")} />)}
              {field("accentColor", "Accent colour (optional)", <Input id="accentColor" placeholder="#275DF5" value={v.accentColor ?? ""} onChange={set("accentColor")} />)}
              {field("retentionDays", "Data retention (days)", <Input id="retentionDays" type="number" min={1} max={3650} required value={v.retentionDays ?? 90} onChange={(e) => setV({ ...v, retentionDays: e.target.valueAsNumber })} />)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="voice" keepMounted>
          <Card>
            <CardHeader><CardTitle>Call handling</CardTitle></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              {field(
                "vapiMode",
                "Vapi account",
                <FormSelect id="vapiMode" value={v.vapiMode} choices={[{ value: "own", label: "Own account" }, { value: "pool", label: "Demo pool" }]}
                  onChange={(value) => setV({ ...v, vapiMode: value === "pool" ? "pool" : "own" })} />,
              )}
              <div className="space-y-2">
                <Label><input type="checkbox" checked={v.recordingEnabled ?? false} onChange={(e) => setV({ ...v, recordingEnabled: e.target.checked })} /> Record calls with verbal consent</Label>
                <p className="text-sm text-muted-foreground">{recordingApproved
                  ? "Sync the agent to apply changes to call recording."
                  : "Recording requires approval for this workspace. Sync the agent to apply the unrecorded policy."}</p>
              </div>
              <Label><input type="checkbox" checked={v.transferEnabled ?? false} onChange={(e) => setV({ ...v, transferEnabled: e.target.checked })} /> Enable live transfer</Label>
              <p className="text-sm">Live transfer uses paid outbound minutes.</p>
              {field("callbackMinutes", "Callback minutes", <Input id="callbackMinutes" type="number" min={1} max={120} required value={v.callbackMinutes ?? 15} onChange={(e) => setV({ ...v, callbackMinutes: e.target.valueAsNumber })} />)}
              {field("onCallNumber", "On-call number (international format)", <Input id="onCallNumber" value={v.onCallNumber ?? ""} onChange={set("onCallNumber")} />)}
              {field("backupNumber", "Backup number (international format)", <Input id="backupNumber" value={v.backupNumber ?? ""} onChange={set("backupNumber")} />)}
              {field("escalationTriggers", "Escalation triggers", <Textarea id="escalationTriggers" value={v.escalationTriggers ?? ""} onChange={set("escalationTriggers")} />)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="business" keepMounted>
          <Card>
            <CardHeader><CardTitle>Business information</CardTitle></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              {field("serviceZips", "Service ZIP codes (comma separated)", <Input id="serviceZips" value={zipText} onChange={(e) => setZipText(e.target.value)} />)}
              {field("serviceCities", "City exceptions (comma separated)", <Input id="serviceCities" value={cityText} onChange={(e) => setCityText(e.target.value)} />)}
              {field("hours", "Opening hours", <Textarea id="hours" value={v.businessInfo.hours} onChange={setInfo("hours")} />)}
              {field("address", "Address", <Input id="address" value={v.businessInfo.address} onChange={setInfo("address")} />)}
              {field("serviceArea", "Service area", <Input id="serviceArea" value={v.businessInfo.serviceArea} onChange={setInfo("serviceArea")} />)}
              {field("faq", "FAQ", <Textarea id="faq" value={v.businessInfo.faq} onChange={setInfo("faq")} />)}
              {field("policies", "Policies", <Textarea id="policies" value={v.businessInfo.policies} onChange={setInfo("policies")} />)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {message && <p role="status" className="text-sm">{message}</p>}
      {!!Object.keys(fields).length && <p role="alert" className="text-destructive">{Object.values(fields)[0]}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="page-action" type="submit">{id ? "Save" : "Create workspace"}</Button>
        {id && <Dialog>
          <DialogTrigger render={<Button type="button" variant="outline" />}>Archive</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Archive this workspace?</DialogTitle>
              <DialogDescription>Booking and voice tools will be unavailable for this workspace. Existing records will be kept.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Go back</DialogClose>
              <Button type="button" variant="destructive" onClick={archive}>Archive workspace</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </div>
    </form>
  );
}
