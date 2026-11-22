/**
 * Run against a disposable benchmark workspace and calendar with free slots:
 * pnpm exec tsx --env-file=.env.local scripts/measure-tools.ts <workspace> <callback-phone> [baseUrl]
 * The benchmark creates appointments and Google events. Use a synthetic callback number and leave
 * owner notifications disabled on that workspace. The app and script must point at the same database.
 */
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { normalizePhone } from "@/lib/crm/contacts";
import { decrypt } from "@/lib/crypto";
import { client, db } from "@/lib/db/client";
import { appointments, assistantSyncs, assistants, calendars, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";

const reply = z.object({ results: z.array(z.object({ toolCallId: z.string(), result: z.string() })).length(1) });
const options = z.object({ data: z.object({ options: z.array(z.object({
  slot_id: z.uuid(), start: z.iso.datetime({ offset: true }),
})).min(1) }) });
const confirmation = z.object({ data: z.object({ appointmentId: z.uuid(), reference: z.string().min(1), start: z.iso.datetime() }) });

type Mode = "cache hit" | "cache miss" | "booking";
const runs: Record<Mode, number[]> = { "cache hit": [], "cache miss": [], booking: [] };

async function main() {
  const [slug, phone, url = env.APP_URL] = process.argv.slice(2);
  if (!slug?.startsWith("benchmark-") || !phone) throw new Error("Pass a disposable benchmark-* workspace and callback phone.");
  const base = new URL(url);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Use HTTPS for remote benchmarks.");

  const [workspace] = await db.select().from(workspaces).where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  if (!workspace || !normalizePhone(phone, workspace.country)) throw new Error("Choose an active benchmark workspace and a usable callback number.");
  if (workspace.serviceCities.length || workspace.serviceZips.length) throw new Error("Use an unrestricted benchmark workspace.");
  const [[sync], [service], [calendar]] = await Promise.all([
    db.select({ id: assistantSyncs.vapiAssistantId }).from(assistantSyncs)
      .innerJoin(assistants, eq(assistants.id, assistantSyncs.assistantId)).where(eq(assistants.workspaceId, workspace.id)),
    db.select({ name: services.name, id: services.id }).from(services)
      .where(and(eq(services.workspaceId, workspace.id), eq(services.active, true), eq(services.visitKind, "standard"))),
    db.select().from(calendars).where(eq(calendars.workspaceId, workspace.id)),
  ]);
  if (!sync?.id || !service || !calendar?.googleCalendarId) throw new Error("Connect the benchmark calendar and sync a standard service.");
  const assistantId = sync.id;
  const headers = { "content-type": "application/json", "x-vapi-secret": decrypt(workspace.webhookSecretEncrypted) };
  const dates = Array.from({ length: Math.min(calendar.maxDaysAhead - 1, 20) }, (_, i) => DateTime.now().setZone(workspace.timezone).plus({ days: i + 2 }))
    .filter((day) => (calendar.workingHours as Record<string, unknown>)[day.setLocale("en").toFormat("ccc").toLowerCase()]);
  if (!dates.length) throw new Error("The benchmark needs future working days.");

  async function time(callId: string, name: string, args: Record<string, string>) {
    const id = crypto.randomUUID();
    const start = performance.now();
    const response = await fetch(new URL("/api/vapi/tools", base), {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ message: {
        type: "tool-calls", call: { id: callId, assistantId, type: "webCall" },
        toolCallList: [{ id, function: { name, arguments: { service: service.name, ...args } } }],
      } }),
    });
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
    const [tool] = reply.parse(await response.json()).results;
    const elapsed = performance.now() - start;
    if (tool.toolCallId !== id) throw new Error("Tool reply ID mismatch.");
    try { return { elapsed, result: JSON.parse(tool.result) as unknown }; }
    catch { throw new Error(`${name} did not return a structured success result.`); }
  }

  for (const day of dates) {
    const date = day.toISODate()!;
    const callId = crypto.randomUUID();
    await db.update(calendars).set({ busyCache: null, busyCachedAt: null }).where(eq(calendars.workspaceId, workspace.id));
    const miss = await time(callId, "check_availability", { date });
    const hit = await time(crypto.randomUUID(), "check_availability", { date });
    const choices = options.parse(miss.result).data.options;
    const cached = options.parse(hit.result).data.options;
    if (choices.some((choice, index) => choice.start !== cached[index]?.start
      || !DateTime.fromISO(choice.start).setZone(workspace.timezone).hasSame(day, "day"))) {
      throw new Error("The samples must offer the same slots on the benchmark day.");
    }
    runs["cache miss"].push(miss.elapsed);
    runs["cache hit"].push(hit.elapsed);

    const bookingCallId = crypto.randomUUID();
    const offer = await time(bookingCallId, "check_availability", { date });
    const chosen = options.parse(offer.result).data.options[0];
    const booked = await time(bookingCallId, "book_appointment", { slot_id: chosen.slot_id, name: "Benchmark caller", phone });
    const { data } = confirmation.parse(booked.result);
    const [stored] = await db.select().from(appointments)
      .where(and(eq(appointments.id, data.appointmentId), eq(appointments.workspaceId, workspace.id)));
    if (data.start !== chosen.start || !stored?.googleEventId || stored.status !== "booked"
      || stored.serviceId !== service.id || stored.startAt.toISOString() !== chosen.start) {
      throw new Error("The booking did not match the chosen slot and calendar event.");
    }
    runs.booking.push(booked.elapsed);
  }

  for (const [mode, times] of Object.entries(runs)) {
    times.sort((a, b) => a - b);
    const percentile = (quantile: number) => Math.round(times[Math.ceil(times.length * quantile) - 1]);
    console.log(`${mode}: ${times.length} successful samples, p50 ${percentile(0.5)} ms, p95 ${percentile(0.95)} ms`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed");
  process.exitCode = 1;
}).finally(() => client.end());
