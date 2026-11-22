"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const days = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

type Hours = Record<string, { open: string; close: string } | null | undefined>;
type Service = { id?: string; name: string; visitKind: "standard" | "estimate"; durationMin: number; bufferMin: number; priceText: string; active: boolean };
type CalendarOption = { id: string; summary: string; primary: boolean };

type Initial = {
  connected: boolean;
  googleCalendarId: string | null;
  workingHours: Hours;
  slotStepMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  services: Service[];
};

const select = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

async function send(url: string, body: unknown) {
  const res = await fetch(url, { method: "PUT", body: JSON.stringify(body) });
  const data = await res.json();
  return res.ok ? null : ((data.fields && Object.values(data.fields)[0]) as string | undefined) ?? data.error ?? "Save failed";
}

export function BookingForm({ workspaceId, initial, notice }: { workspaceId: string; initial: Initial; notice: string }) {
  const [calendarId, setCalendarId] = useState(initial.googleCalendarId ?? "");
  const [options, setOptions] = useState<CalendarOption[]>([]);
  const [hours, setHours] = useState<Hours>(initial.workingHours);
  const [step, setStep] = useState(initial.slotStepMin);
  const [minNotice, setMinNotice] = useState(initial.minNoticeHours);
  const [ahead, setAhead] = useState(initial.maxDaysAhead);
  const [list, setList] = useState<Service[]>(initial.services);
  const [calendarMessage, setCalendarMessage] = useState(notice);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [servicesMessage, setServicesMessage] = useState("");

  useEffect(() => {
    if (!initial.connected) return;
    fetch(`/api/workspaces/${workspaceId}/calendars`)
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => (ok ? setOptions(body.calendars) : setCalendarMessage(body.error ?? "Could not list calendars")))
      .catch(() => setCalendarMessage("Could not list calendars"));
  }, [workspaceId, initial.connected]);

  async function saveSettings() {
    setSettingsMessage("Saving...");
    const error = await send(`/api/workspaces/${workspaceId}/booking`, {
      googleCalendarId: calendarId || null,
      workingHours: hours,
      slotStepMin: step,
      minNoticeHours: minNotice,
      maxDaysAhead: ahead,
    });
    setSettingsMessage(error ?? "Saved");
  }

  async function saveServices() {
    setServicesMessage("Saving...");
    const error = await send(`/api/workspaces/${workspaceId}/services`, { services: list });
    setServicesMessage(error ?? "Saved");
  }

  const setService = (index: number, patch: Partial<Service>) =>
    setList((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const setDay = (day: string, patch: Partial<{ open: string; close: string }> | null) =>
    setHours((current) => ({ ...current, [day]: patch === null ? null : { ...(current[day] ?? { open: "09:00", close: "17:00" }), ...patch } }));

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm">{initial.connected ? "Connected." : "Not connected."}</p>
          <div>
            <a
              href={`/api/google/oauth/start?workspaceId=${workspaceId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {initial.connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </a>
          </div>
          {initial.connected && (
            <div className="grid gap-1">
              <Label htmlFor="calendar">Calendar for bookings</Label>
              <select id="calendar" className={select} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                <option value="">Choose a calendar</option>
                {calendarId && !options.some((o) => o.id === calendarId) && <option value={calendarId}>{calendarId}</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.summary}
                    {o.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {calendarMessage && <p className="text-sm">{calendarMessage}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {list.map((s, i) => (
            <div key={s.id ?? `new-${i}`} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
              <div className="col-span-2 grid gap-1">
                <Label htmlFor={`name-${i}`}>Name</Label>
                <Input id={`name-${i}`} value={s.name} onChange={(e) => setService(i, { name: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`dur-${i}`}>Minutes</Label>
                <Input id={`dur-${i}`} type="number" value={s.durationMin} onChange={(e) => setService(i, { durationMin: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`buf-${i}`}>Buffer</Label>
                <Input id={`buf-${i}`} type="number" value={s.bufferMin} onChange={(e) => setService(i, { bufferMin: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`kind-${i}`}>Visit kind</Label>
                <select id={`kind-${i}`} value={s.visitKind} className={select}
                  onChange={(e) => setService(i, { visitKind: e.target.value === "estimate" ? "estimate" : "standard" })}>
                  <option value="standard">Standard</option><option value="estimate">Estimate</option>
                </select>
                <Label htmlFor={`price-${i}`}>Price</Label>
                <Input id={`price-${i}`} value={s.priceText} onChange={(e) => setService(i, { priceText: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pb-1 text-sm">
                <input type="checkbox" checked={s.active} onChange={(e) => setService(i, { active: e.target.checked })} />
                Active
              </label>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setList((c) => [...c, { name: "", visitKind: "standard", durationMin: 30, bufferMin: 0, priceText: "", active: true }])}
            >
              Add service
            </Button>
            <Button type="button" size="sm" onClick={saveServices}>Save services</Button>
            {servicesMessage && <span className="text-sm">{servicesMessage}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Working hours and slots</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {days.map(([key, label]) => {
            const day = hours[key];
            return (
              <div key={key} className="flex items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(day)} onChange={(e) => setDay(key, e.target.checked ? {} : null)} />
                  {label}
                </label>
                {day && (
                  <>
                    <Input aria-label={`${label} opens`} className="w-28" type="time" value={day.open} onChange={(e) => setDay(key, { open: e.target.value })} />
                    <span className="text-sm">to</span>
                    <Input aria-label={`${label} closes`} className="w-28" type="time" value={day.close} onChange={(e) => setDay(key, { close: e.target.value })} />
                  </>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="step">Slot step (minutes)</Label>
              <Input id="step" type="number" value={step} onChange={(e) => setStep(Number(e.target.value))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="notice">Minimum notice (hours)</Label>
              <Input id="notice" type="number" value={minNotice} onChange={(e) => setMinNotice(Number(e.target.value))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ahead">Book up to (days ahead)</Label>
              <Input id="ahead" type="number" value={ahead} onChange={(e) => setAhead(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={saveSettings}>Save calendar and hours</Button>
            {settingsMessage && <span className="text-sm">{settingsMessage}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
