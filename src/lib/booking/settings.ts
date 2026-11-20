import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { calendars, services } from "@/lib/db/schema";

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const dayHours = z
  .object({ open: time, close: time })
  .refine((d) => d.open < d.close, "Closing time must be after opening time");

export const bookingSettings = z.object({
  googleCalendarId: z.string().min(1).nullable(),
  workingHours: z.partialRecord(z.enum(weekdays), dayHours.nullable()),
  slotStepMin: z.number().int().min(5).max(240),
  minNoticeHours: z.number().int().min(0).max(720),
  maxDaysAhead: z.number().int().min(1).max(365),
});
export type BookingSettings = z.infer<typeof bookingSettings>;

export const servicesInput = z.object({
  services: z.array(
    z.object({
      id: z.uuid().optional(),
      name: z.string().trim().min(1, "Name is required"),
      durationMin: z.number().int().min(5).max(480),
      bufferMin: z.number().int().min(0).max(240),
      priceText: z.string().trim(),
      active: z.boolean(),
    }),
  ),
});
export type ServicesInput = z.infer<typeof servicesInput>;

export async function getBookingSettings(workspaceId: string) {
  const [row] = await db.select().from(calendars).where(eq(calendars.workspaceId, workspaceId));
  return row ?? null;
}

/** Closed days are stored as missing keys. */
export async function saveBookingSettings(workspaceId: string, input: BookingSettings) {
  const workingHours = Object.fromEntries(Object.entries(input.workingHours).filter(([, hours]) => hours));
  const values = {
    googleCalendarId: input.googleCalendarId,
    workingHours,
    slotStepMin: input.slotStepMin,
    minNoticeHours: input.minNoticeHours,
    maxDaysAhead: input.maxDaysAhead,
    busyCache: null,
    busyCachedAt: null,
  };
  const [row] = await db
    .insert(calendars)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: calendars.workspaceId, set: values })
    .returning();
  return row;
}

export function listServices(workspaceId: string) {
  return db.select().from(services).where(eq(services.workspaceId, workspaceId)).orderBy(asc(services.name));
}

/** Upserts the list. Services are never deleted, only deactivated, so appointments keep their link. */
export async function saveServices(workspaceId: string, input: ServicesInput) {
  await db.transaction(async (tx) => {
    for (const { id, ...values } of input.services) {
      const updated = id
        ? await tx
            .update(services)
            .set(values)
            .where(and(eq(services.id, id), eq(services.workspaceId, workspaceId)))
            .returning({ id: services.id })
        : [];
      if (!updated.length) await tx.insert(services).values({ workspaceId, ...values });
    }
  });
  return listServices(workspaceId);
}
