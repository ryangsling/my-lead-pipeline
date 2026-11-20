"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Service = { id: string; name: string; durationMin: number; priceText: string | null };
type Slot = { start: string; end: string };
type Done = { start: string; reference: string };

const select = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function BookingWidget({ publicKey, timezone, services }: { publicKey: string; timezone: string; services: Service[] }) {
  const [serviceId, setServiceId] = useState(services[0].id);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const dayLabel = useCallback(
    (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso)),
    [timezone],
  );
  const timeLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const apply = useCallback((res: { ok: boolean; body: { slots?: Slot[]; error?: string } }) => {
    setSlots(res.body.slots ?? []);
    if (!res.ok) setError(res.body.error ?? "Could not load times");
  }, []);

  const fetchSlots = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/public/${publicKey}/slots?serviceId=${id}`);
      return { ok: res.ok, body: await res.json() };
    },
    [publicKey],
  );

  useEffect(() => {
    let active = true;
    fetchSlots(serviceId).then((res) => active && apply(res));
    return () => {
      active = false;
    };
  }, [serviceId, fetchSlots, apply]);

  function chooseService(id: string) {
    setServiceId(id);
    setSlots(null);
    setChosen(null);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/public/${publicKey}/book`, {
      method: "POST",
      body: JSON.stringify({ serviceId, start: chosen, ...form }),
    });
    const body = await res.json();
    setBusy(false);
    if (res.status === 201) {
      setDone({ start: chosen, reference: body.reference });
      return;
    }
    setError((body.fields && Object.values(body.fields)[0]) || body.error || "Booking failed");
    if (res.status === 409) {
      setChosen(null);
      apply(await fetchSlots(serviceId));
    }
  }

  if (done) {
    return (
      <div className="grid gap-2">
        <p className="font-medium">You are booked in.</p>
        <p className="text-sm">
          {dayLabel(done.start)} at {timeLabel(done.start)}. Your reference is {done.reference}.
        </p>
      </div>
    );
  }

  const days = new Map<string, Slot[]>();
  for (const slot of slots ?? []) days.set(dayLabel(slot.start), [...(days.get(dayLabel(slot.start)) ?? []), slot]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Label htmlFor="service">Service</Label>
        <select id="service" className={select} value={serviceId} onChange={(e) => chooseService(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMin} min{s.priceText ? `, ${s.priceText}` : ""})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3">
        <p className="text-sm">Times are shown in {timezone}.</p>
        {slots === null && <p className="text-sm">Loading times...</p>}
        {slots?.length === 0 && <p className="text-sm">No times are free in the next two weeks.</p>}
        {[...days].map(([day, list]) => (
          <div key={day} className="grid gap-1">
            <p className="text-sm font-medium">{day}</p>
            <div className="flex flex-wrap gap-1">
              {list.map((s) => (
                <Button key={s.start} type="button" size="sm" variant={chosen === s.start ? "default" : "outline"} aria-pressed={chosen === s.start} onClick={() => setChosen(s.start)}>
                  {timeLabel(s.start)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {chosen && (
        <form onSubmit={submit} className="grid gap-3">
          <p className="text-sm">
            {dayLabel(chosen)} at {timeLabel(chosen)}
          </p>
          <div className="grid gap-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="notes">Anything we should know (optional)</Label>
            <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div>
            <Button type="submit" disabled={busy}>{busy ? "Booking..." : "Book"}</Button>
          </div>
        </form>
      )}
      {error && <p role="status" className="text-sm">{error}</p>}
    </div>
  );
}
