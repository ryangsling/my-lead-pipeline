import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** 401 means no session, 403 means signed in but not an admin. */
export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(status === 401 ? "Not signed in" : "Not an admin");
  }
}

export function isAdminEmail(email: string): boolean {
  const allowed = env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase());
  return allowed.includes(email.toLowerCase());
}

/** Verifies the session with Supabase and checks ADMIN_EMAILS. Call it in every admin route and action. */
export async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new AuthError(401);
  if (!isAdminEmail(email)) throw new AuthError(403);
  return { email };
}

/** For pages and layouts: send anyone who is not an admin to /login. */
export async function requireAdminOrRedirect(): Promise<{ email: string }> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }
}
