import { and, eq } from "drizzle-orm";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { db } from "@/lib/db/client";
import { contacts, workspaces } from "@/lib/db/schema";

export type UpsertContactInput = {
  workspaceId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source: "phone" | "web_voice" | "chat" | "form";
};
export type UpsertContactResult = { ok: true; id: string } | { ok: false; error: "invalid_phone" };

/**
 * E.164 using the workspace country for national numbers, or null if the number cannot exist.
 * isValid rejects unassigned ranges like 07700 900xxx, and a caller should not be turned away for that, so a
 * possible number with at least 8 digits is accepted too. isPossible alone lets 7-digit local-only numbers through.
 */
export function normalizePhone(phone: string, country: string): string | null {
  const parsed = parsePhoneNumberFromString(phone, country as CountryCode);
  if (!parsed) return null;
  return parsed.isValid() || (parsed.isPossible() && parsed.nationalNumber.length >= 8) ? parsed.number : null;
}

/** Matches by phone, then email, inside the workspace. Fills in missing fields on a match. */
export async function upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
  const { workspaceId } = input;
  const [workspace] = await db.select({ country: workspaces.country }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const phone = input.phone?.trim() ? normalizePhone(input.phone, workspace?.country ?? "GB") : null;
  if (input.phone?.trim() && !phone) return { ok: false, error: "invalid_phone" };
  const email = input.email?.trim().toLowerCase() || null;
  const name = input.name?.trim() || null;

  const find = async () => {
    if (phone) {
      const [byPhone] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.phoneE164, phone)));
      if (byPhone) return byPhone;
    }
    if (email) {
      const [byEmail] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)));
      return byEmail;
    }
  };

  const existing = await find();
  if (existing) {
    await db
      .update(contacts)
      .set({
        name: existing.name ?? name,
        phoneE164: existing.phoneE164 ?? phone,
        email: existing.email ?? email,
      })
      .where(and(eq(contacts.id, existing.id), eq(contacts.workspaceId, workspaceId)));
    return { ok: true, id: existing.id };
  }

  try {
    const [created] = await db
      .insert(contacts)
      .values({ workspaceId, name, phoneE164: phone, email, source: input.source })
      .returning({ id: contacts.id });
    return { ok: true, id: created.id };
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    const raced = code === "23505" ? await find() : undefined;
    if (!raced) throw error;
    return { ok: true, id: raced.id };
  }
}
