import { and, eq, gt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { getOpenSlots, type BookingContext, type BookingService, type OpenSlot } from "@/lib/booking/availability";
import { coverageError, siteFields, type ServiceArea } from "@/lib/booking/coverage";
import { getWorkspaceCalendar } from "@/lib/google/calendar";
import { bookAppointment } from "@/lib/booking/book";
import { upsertContact, type UpsertContactInput } from "@/lib/crm/contacts";
import { notifyUrgent } from "@/lib/notifications/urgent";
import { intakeFields, saveJob } from "@/lib/crm/jobs";
import { db } from "@/lib/db/client";
import { conversations, offeredSlots, services, workspaces } from "@/lib/db/schema";
import { lockPrivacy } from "@/lib/privacy/scope";
import { inPartOfDay, reference, spokenList, spokenTime, todayLine, type PartOfDay } from "./speak";

type ToolWorkspace = ServiceArea & { timezone: string; country: string };
export type ToolContext = {
  workspace?: ToolWorkspace;
  workspaceId: string;
  conversationId: string | null;
  channel: "phone" | "web_voice" | "chat";
  defer?: (work: () => Promise<void>) => void;
};
export type ToolResult = { result: string; data?: unknown };

const short = z.string().trim().min(1).max(120);
const optional = z.string().trim().max(500).optional();
const schemas = {
  notify_urgent: z.object({
    ...intakeFields, name: short, phone: z.string().trim().min(1).max(40),
    problem: z.string().trim().min(1).max(500),
  }),
  check_availability: z.object({
    ...siteFields,
    service: short,
    date: z.string().trim().pipe(z.union([z.enum(["today", "tomorrow"]), z.iso.date()])).optional(),
    part_of_day: z.string().trim().pipe(z.enum(["morning", "afternoon", "evening", "any"])).optional(),
  }),
  book_appointment: z.object({
    ...intakeFields,
    service: short,
    slot_id: short,
    name: short,
    phone: z.string().trim().min(1).max(40),
    email: z.string().trim().max(254).pipe(z.email()).optional(),
    notes: optional,
  }),
  capture_lead: z.object({
    ...intakeFields,
    name: short,
    phone: z.string().trim().min(1).max(40),
    email: z.string().trim().max(254).pipe(z.email()).optional(),
    reason: optional,
    preferred_time: optional,
  }),
};

type Env = { area: ServiceArea; country: string; zone: string; now: DateTime; say: (text: string, data?: unknown) => ToolResult };

const BAD_PHONE = "That phone number does not look right. Could you say it again, with the area code?";
const BOOKING_CALENDAR_ERROR = "I could not save that to the calendar, so nothing is booked yet. I can take your details and the team will call you back.";
const NO_CALENDAR = "I cannot check the calendar right now. I can take your details and the team will call you back.";
const CALL_UNAVAILABLE = "I cannot save your details for this call. Please call back.";

async function contactForTool(ctx: ToolContext, details: Pick<UpsertContactInput, "name" | "phone" | "email">, country: string) {
  const input = { workspaceId: ctx.workspaceId, source: ctx.channel, ...details };
  const conversationId = ctx.conversationId;
  if (!conversationId) return upsertContact(input, country);
  return db.transaction(async tx => {
    await lockPrivacy(tx, ctx.workspaceId);
    const key = and(eq(conversations.workspaceId, ctx.workspaceId), eq(conversations.id, conversationId));
    const [call] = await tx.select({ id: conversations.id }).from(conversations).where(key);
    if (!call) return null;
    const contact = await upsertContact(input, country, tx);
    if (contact.ok) await tx.update(conversations).set({ contactId: contact.id }).where(key);
    return contact;
  });
}

async function findService(workspaceId: string, name: string) {
  const active = await db
    .select()
    .from(services)
    .where(and(eq(services.workspaceId, workspaceId), eq(services.active, true)));
  const wanted = name.trim().toLowerCase();
  const exact = active.find((s) => s.name.toLowerCase() === wanted);
  const partial = active.filter((s) => s.name.toLowerCase().includes(wanted) || wanted.includes(s.name.toLowerCase()));
  const service = exact ?? (partial.length === 1 ? partial[0] : undefined);
  if (service) return { service };
  const names = active.map((s) => s.name);
  return {
    message: names.length
      ? `I do not have a service called ${name}. We offer ${spokenList(names)}.`
      : "No services are set up yet. I can take your details and the team will call you back.",
  };
}

/** Free slots from `from` to `to` (dates), filtered by part of day. Null if the calendar cannot be read. */
async function freeSlots(ctx: ToolContext, booking: BookingContext, zone: string, from: string, to: string, part: PartOfDay = "any") {
  const slots = await getOpenSlots({ workspaceId: ctx.workspaceId, serviceId: booking.service.id, from, to, limit: 300 }, booking).catch(() => null);
  return slots && slots.filter((s) => inPartOfDay(s.start, zone, part));
}

async function bookingContext(ctx: ToolContext, service: BookingService, zone: string) {
  const calendar = await getWorkspaceCalendar(ctx.workspaceId, zone).catch(() => null);
  return calendar ? { service, calendar } : null;
}

async function offerTimes(ctx: ToolContext, serviceId: string, slots: OpenSlot[], zone: string, prefix: string, { say }: Env) {
  if (!ctx.conversationId) return say("I need a call or chat session to offer times.");
  const choices = slots.slice(0, 3);
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const rows = await db.insert(offeredSlots).values(choices.map((slot) => ({
    workspaceId: ctx.workspaceId, conversationId: ctx.conversationId!, serviceId, start: new Date(slot.start), expiresAt,
  }))).returning();
  const options = rows.map((row) => ({ slot_id: row.id, start: row.start.toISOString(), time: spokenTime(row.start.toISOString(), zone) }));
  return say(`${prefix} ${spokenList(options.map((option) => option.time))}.`, { options });
}

export function requestedDay(date: string | undefined, now: DateTime) {
  if (!date || date === "today") return now.startOf("day");
  if (date === "tomorrow") return now.plus({ days: 1 }).startOf("day");
  return DateTime.fromISO(date, { zone: now.zoneName ?? "UTC" });
}

async function checkAvailability(args: z.infer<typeof schemas.check_availability>, ctx: ToolContext, env: Env, service?: BookingService) {
  const { zone, now, say } = env;
  const areaIssue = coverageError(env.area, args);
  if (areaIssue) return say(`${areaIssue} I can take your details for the team.`);
  const found = service ? { service } : await findService(ctx.workspaceId, args.service);
  if (!found.service) return say(found.message);
  const day = requestedDay(args.date, now);
  if (day < now.startOf("day")) return say("That date is in the past. Which upcoming day works for you?");
  const date = day.toISODate()!;
  const booking = await bookingContext(ctx, found.service, zone);
  if (!booking) return say(NO_CALENDAR);

  const asked = await freeSlots(ctx, booking, zone, date, args.date ? date : (day.plus({ days: 7 }).toISODate() as string), args.part_of_day);
  if (!asked) return say(NO_CALENDAR);
  if (asked.length) return offerTimes(ctx, found.service.id, asked, zone, `${found.service.name} has these times free:`, env);

  const later = await freeSlots(ctx, booking, zone, date, day.plus({ days: 14 }).toISODate() as string);
  if (!later) return say(NO_CALENDAR);
  if (!later.length) return say("I cannot see any free times in the next two weeks. I can take your details and the team will call you back.");
  const when = args.date ? `on ${day.toFormat("cccc d LLLL")}` : "then";
  const unavailable = args.part_of_day && args.part_of_day !== "any"
    ? `No ${args.part_of_day} times are free` : "Nothing is free";
  return offerTimes(ctx, found.service.id, later, zone, `${unavailable} ${when}. The nearest times are`, env);
}

async function bookAppointmentTool(args: z.infer<typeof schemas.book_appointment>, ctx: ToolContext, env: Env) {
  const { country, zone, now, say } = env;
  const areaIssue = coverageError(env.area, args);
  if (areaIssue) return say(`${areaIssue} I can take your details for the team.`);
  const found = await findService(ctx.workspaceId, args.service);
  if (!found.service) return say(found.message);

  const [slot] = ctx.conversationId && z.uuid().safeParse(args.slot_id).success
    ? await db.select().from(offeredSlots).where(and(
      eq(offeredSlots.id, args.slot_id), eq(offeredSlots.workspaceId, ctx.workspaceId),
      eq(offeredSlots.conversationId, ctx.conversationId), eq(offeredSlots.serviceId, found.service.id),
      gt(offeredSlots.expiresAt, new Date()),
    ))
    : [];
  if (!slot) {
    const next = await checkAvailability({ service: args.service, zip: args.zip, city: args.city }, ctx, env, found.service);
    return { ...next, result: `That time is no longer available. ${next.result}` };
  }
  const contact = await contactForTool(ctx, args, country);
  if (!contact) return say(CALL_UNAVAILABLE);
  if (!contact.ok) return say(BAD_PHONE);

  const booking = await bookingContext(ctx, found.service, zone);
  if (!booking) return say(BOOKING_CALENDAR_ERROR);
  const result = await bookAppointment({
    workspaceId: ctx.workspaceId,
    serviceId: found.service.id,
    contactId: contact.id,
    start: slot.start,
    source: ctx.channel,
    conversationId: ctx.conversationId,
    site: args,
    intake: { job_type: found.service.name, ...args },
    notes: args.notes,
  }, { ...booking, area: env.area });

  if (result.ok) {
    const ref = reference(result.appointment.id);
    return say(
      `You are booked in for ${found.service.visitKind === "estimate" ? "an estimate visit for " : ""}${found.service.name} on ${spokenTime(result.appointment.startAt.toISOString(), zone)}. Your reference is ${ref}.${found.service.visitKind === "estimate" ? " The visit does not guarantee a price or completed work." : ""}`,
      { appointmentId: result.appointment.id, reference: ref, start: result.appointment.startAt.toISOString() },
    );
  }

  if (result.reason === "pending" || result.reason === "outside_area" || result.reason === "missing_location") return say(result.message);
  if (result.reason === "calendar_error") {
    return say(BOOKING_CALENDAR_ERROR);
  }
  const requested = DateTime.fromJSDate(slot.start, { zone });
  const from = (requested.isValid && requested > now ? requested : now).toISODate() as string;
  const nearby = await freeSlots(ctx, booking, zone, from, DateTime.fromISO(from, { zone }).plus({ days: 7 }).toISODate() as string);
  const lead = result.reason === "slot_taken" ? "That time was just taken." : "That time is not available.";
  if (!nearby?.length) return say(`${lead} I have no other times to offer right now. I can take your details and the team will call you back.`);
  return offerTimes(ctx, found.service.id, nearby, zone, `${lead} I can offer`, env);
}

async function captureLead(args: z.infer<typeof schemas.capture_lead>, ctx: ToolContext, { say, zone, country }: Env) {
  const contact = await contactForTool(ctx, args, country);
  if (!contact) return say(CALL_UNAVAILABLE);
  if (!contact.ok) return say(BAD_PHONE);
  if (ctx.conversationId) {
    const intake = { ...args, problem: args.problem ?? args.reason, callback_window: args.callback_window ?? args.preferred_time };
    if (["urgent", "emergency"].includes(args.urgency?.toLowerCase() ?? "")) {
      return urgentReply(await notifyUrgent(ctx.workspaceId, ctx.conversationId, contact.id, zone, intake, ctx.defer), say);
    }
    await saveJob({ workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, contactId: contact.id, timezone: zone,
      intake });
    const details = JSON.stringify({ reason: args.reason, preferred_time: args.preferred_time });
    await db
      .update(conversations)
      .set({ outcome: sql`case when ${conversations.outcome} in ('urgent', 'booked') then ${conversations.outcome} else 'lead' end`, contactId: contact.id, structured: sql`${conversations.structured} || ${details}::jsonb` })
      .where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
  }
  return say("Saved, the team will call you.");
}

/** Pairs a schema with its handler: arguments are validated, and unknown keys are dropped. */
function tool<T extends z.ZodType>(schema: T, run: (args: z.infer<T>, ctx: ToolContext, env: Env) => Promise<ToolResult>) {
  return async (args: unknown, ctx: ToolContext, env: Env) => {
    const parsed = schema.safeParse(args);
    if (parsed.success) return run(parsed.data, ctx, env);
    const missing = [...new Set(parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean))].join(", ");
    return env.say(`I am missing some details${missing ? `: ${missing}` : ""}. Could you give me those?`);
  };
}

async function urgent(args: z.infer<typeof schemas.notify_urgent>, ctx: ToolContext, { say, zone, country }: Env) {
  if (!ctx.conversationId) return say("I need a call or chat session to record an urgent request.");
  const contact = await contactForTool(ctx, args, country);
  if (!contact) return say(CALL_UNAVAILABLE);
  if (!contact.ok) return say(BAD_PHONE);
  return urgentReply(await notifyUrgent(ctx.workspaceId, ctx.conversationId, contact.id, zone, args, ctx.defer), say);
}

function urgentReply(result: { sent: boolean; callbackMinutes: number }, say: Env["say"]) {
  return say(result.sent
    ? `The team has been alerted. Someone will call you back within ${result.callbackMinutes} minutes.`
    : "I recorded your request. I could not confirm an immediate alert to the team.");
}

const tools = {
  notify_urgent: tool(schemas.notify_urgent, urgent),
  check_availability: tool(schemas.check_availability, checkAvailability),
  book_appointment: tool(schemas.book_appointment, bookAppointmentTool),
  capture_lead: tool(schemas.capture_lead, captureLead),
};

/**
 * Shared by voice and chat. The workspace comes only from `ctx`.
 * Always returns a plain sentence ending with today's date, and never throws.
 */
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const [workspace] = ctx.workspace ? [ctx.workspace] : await db.select({ country: workspaces.country, timezone: workspaces.timezone, serviceZips: workspaces.serviceZips, serviceCities: workspaces.serviceCities }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  const zone = workspace?.timezone ?? "UTC";
  const now = DateTime.now().setZone(zone);
  const say = (text: string, data?: unknown): ToolResult => ({ result: `${text} ${todayLine(now)}`, data });

  if (!Object.hasOwn(tools, name)) return say("I cannot do that.");
  try {
    return await tools[name as keyof typeof tools](args, ctx, { zone, now, say, country: workspace?.country ?? "GB", area: workspace ?? { serviceZips: [], serviceCities: [] } });
  } catch {
    return say("Sorry, something went wrong on our side. I can take your details and the team will call you back.");
  }
}
