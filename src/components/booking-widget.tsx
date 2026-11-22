"use client";

import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Service = { id: string; name: string; visitKind: "standard" | "estimate"; durationMin: number; priceText: string | null };
type Slot = { start: string; end: string; repeatedTimeOffset?: string };
type Site = { zip: string; city: string; address: string };
type Confirmation = { slot: Slot; reference: string };
const steps = ["Service", "Time", "Details", "Confirmation"] as const;
const headings = ["Choose a service", "Choose a time", "Your details", "Your booking"] as const;

function timeZoneLabel(zone: string) {
  const name = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longGeneric" })
    .formatToParts(new Date()).find(({ type }) => type === "timeZoneName")?.value;
  return name ?? zone.replaceAll("_", " ");
}

function calendarLink(business: string, service: string, { slot, reference }: Confirmation) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const field = (value: string) => value.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Booking//Calendar//EN", "BEGIN:VEVENT",
    `UID:${reference}-${stamp(slot.start)}@booking`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(slot.start)}`, `DTEND:${stamp(slot.end)}`,
    `SUMMARY:${field(`${service} at ${business}`)}`, `DESCRIPTION:${field(`Booking reference ${reference}`)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export function BookingWidget({ publicKey, timezone, services, restricted, businessName, requestOnly }: {
  publicKey: string; timezone: string; services: Service[]; restricted: boolean; businessName: string; requestOnly: boolean;
}) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [service, setService] = useState<Service | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [site, setSite] = useState<Site>({ zip: "", city: "", address: "" });
  const [confirmedSite, setConfirmedSite] = useState<Site | null>(null);
  const [error, setError] = useState("");
  const [loadingError, setLoadingError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ title: string; message: string } | null>(null);
  const [done, setDone] = useState<Confirmation | null>(null);
  const estimate = service?.visitKind === "estimate";
  const needsSite = restricted || estimate;
  const siteConfirmed = confirmedSite && site.zip === confirmedSite.zip && site.city === confirmedSite.city && site.address === confirmedSite.address;
  const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
  const timeLabel = (slot: Slot) => {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(slot.start));
    return slot.repeatedTimeOffset ? `${time} (${slot.repeatedTimeOffset})` : time;
  };

  useEffect(() => {
    if (!service || step !== 1 || (needsSite && !confirmedSite)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ serviceId: service.id });
    if (needsSite && confirmedSite) {
      params.set("zip", confirmedSite.zip);
      if (confirmedSite.city) params.set("city", confirmedSite.city);
    }
    fetch(`/api/public/${publicKey}/slots?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setLoadingError(body.error || "Could not load times. Please try again.");
          return;
        }
        setSlots(body.slots ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadingError("Could not load times. Please try again.");
      });
    return () => controller.abort();
  }, [publicKey, service, step, needsSite, confirmedSite, revision]);

  function resetTimes() {
    setSlots(null);
    setDay(null);
    setChosen(null);
    setLoadingError("");
  }

  function selectService(value: Service) {
    setService(value);
    setConfirmedSite(null);
    setError("");
    resetTimes();
    setStep(1);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || !service || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/${publicKey}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, start: chosen.start, ...form, ...(needsSite ? confirmedSite : {}), requireRequestOnly: requestOnly || undefined }),
      });
      const body = await res.json();
      if (res.status === 202 && (body.status === "pending" || body.status === "requested")) {
        setReceipt({ title: body.status === "requested" ? "Request received" : headings[3], message: body.message });
        setStep(3);
        return;
      }
      if (res.status === 201) {
        setDone({ slot: chosen, reference: body.reference });
        setStep(3);
        return;
      }
      setError((body.fields && Object.values<string>(body.fields)[0]) || body.error || "Booking failed. Please try again.");
      if (res.status === 409) {
        resetTimes();
        setStep(1);
      }
    } catch {
      setError("Could not reach the booking page. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const days = new Map<string, Slot[]>();
  for (const slot of slots ?? []) {
    const label = dayLabel(slot.start);
    const group = days.get(label) ?? [];
    group.push(slot);
    days.set(label, group);
  }
  const activeDay = day && days.has(day) ? day : days.keys().next().value;

  return (
    <>
      <ol aria-label="Booking progress" className="booking-progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} data-complete={index < step}>
            <span>{index < step ? <Check className="size-3.5" aria-label="Complete" /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <section aria-labelledby="booking-step" className="space-y-4">
        {step > 0 && step < 3 && (
          <button type="button" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => {
            setError("");
            setStep(step === 2 ? 1 : 0);
          }}>
            <ArrowLeft className="size-4" /> {step === 2 ? "Back to times" : "Back to services"}
          </button>
        )}
        <h2 id="booking-step" className="text-xl font-semibold tracking-tight">{receipt?.title ?? (requestOnly && step === 1 ? "Choose a preferred time" : headings[step])}</h2>
        {receipt && <p role="status">{receipt.message}</p>}
        {error && <p role="alert" className="rounded-xl bg-[#fff1f2] p-3 text-sm text-[#9f1239]">{error}</p>}

        {step === 0 && <ul className="grid gap-3">
          {services.map((value) => <li key={value.id}>
            <button type="button" className="service-choice" onClick={() => selectService(value)}>
              <span className="min-w-0">
                <strong className="block font-semibold">{value.name}</strong>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="size-4" /> {value.durationMin} min{value.priceText ? ` · ${value.priceText}` : ""}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </button>
          </li>)}
        </ul>}

        {step === 1 && <>
          <p className="text-sm text-muted-foreground">{service?.name} · {service?.durationMin} min</p>
          {needsSite && <form className="grid gap-3" onSubmit={(event) => {
            event.preventDefault();
            resetTimes();
            setError("");
            setConfirmedSite({ ...site });
          }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label htmlFor="site-zip">ZIP code</Label>
                <Input id="site-zip" required pattern="[0-9]{5}" inputMode="numeric" value={site.zip} onChange={(event) => setSite({ ...site, zip: event.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="site-city">City</Label>
                <Input id="site-city" value={site.city} onChange={(event) => setSite({ ...site, city: event.target.value })} /></div>
            </div>
            {estimate && <div className="grid gap-2"><Label htmlFor="site-address">Site address</Label>
              <Input id="site-address" required value={site.address} onChange={(event) => setSite({ ...site, address: event.target.value })} /></div>}
            <Button type="submit" variant="outline">Show times</Button>
          </form>}
          {(!needsSite || siteConfirmed) && <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">Times shown in {timeZoneLabel(timezone)}.</p>
            {loadingError ? <div className="grid gap-2">
              <p role="alert" className="text-[#9f1239]">{loadingError}</p>
              <Button variant="outline" onClick={() => { resetTimes(); setRevision((value) => value + 1); }}>Try again</Button>
            </div> : slots === null ? <div role="status" className="grid gap-2 text-sm text-muted-foreground">
              Loading times… <Skeleton className="h-10 w-full" />
            </div> : slots.length === 0 ? <p role="status" className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No times are available for this service.</p> : <>
              <div role="group" aria-label="Days" className="flex flex-wrap gap-2">
                {[...days.keys()].map((label) => <button key={label} type="button" className="booking-chip" aria-pressed={label === activeDay} onClick={() => setDay(label)}>{label}</button>)}
              </div>
              <div role="group" aria-label="Times" className="flex flex-wrap gap-2 border-t pt-4">
                {activeDay && days.get(activeDay)?.map((slot) => <button key={slot.start} type="button" className="booking-chip" onClick={() => {
                  setError("");
                  setChosen(slot);
                  setStep(2);
                }}>{timeLabel(slot)}</button>)}
              </div>
            </>}
          </div>}
        </>}

        {step === 2 && chosen && <>
          <p className="booking-summary"><CalendarDays className="size-4 shrink-0" /> {service?.name} · {dayLabel(chosen.start)} at {timeLabel(chosen)}</p>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2"><Label htmlFor="booking-name">Name</Label>
              <Input id="booking-name" required autoComplete="name" maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="booking-phone">Phone</Label>
              <Input id="booking-phone" type="tel" required autoComplete="tel" maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="booking-email">Email (optional)</Label>
              <Input id="booking-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="booking-notes">Anything we should know (optional)</Label>
              <Textarea id="booking-notes" maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
            <Button type="submit" disabled={busy}>
              {requestOnly ? (busy ? "Sending…" : "Send request") : (busy ? "Booking…" : "Book")}
            </Button>
          </form>
        </>}

        {step === 3 && done && service && <div className="space-y-4">
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-[#e8f6ed] text-[#14643b]"><Check aria-hidden="true" /></div>
          <p className="text-lg font-semibold">{estimate ? "Your estimate visit is booked." : "You are booked in."}</p>
          <p className="booking-summary"><CalendarDays className="size-4 shrink-0" /> {service.name} · {dayLabel(done.slot.start)} at {timeLabel(done.slot)}</p>
          <p className="text-sm text-muted-foreground">Your reference is {done.reference}.</p>
          {estimate && <p className="text-sm text-muted-foreground">The visit does not guarantee a price or completed work.</p>}
          <a className="booking-chip inline-flex items-center gap-2" href={calendarLink(businessName, service.name, done)} download="appointment.ics"><CalendarDays className="size-4" /> Add to calendar</a>
        </div>}
      </section>
    </>
  );
}
