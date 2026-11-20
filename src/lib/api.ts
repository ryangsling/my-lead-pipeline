import { z } from "zod";
import { AuthError, requireAdmin } from "@/lib/auth";

export function errorResponse(status: number, message: string, fields?: Record<string, string>) {
  return Response.json({ error: message, fields }, { status });
}

/** Wraps an admin route handler: 401 with no session, 403 for a non-admin. The handler gets the admin first. */
export function withAdmin<Args extends unknown[]>(
  handler: (admin: { email: string }, ...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    let admin: { email: string };
    try {
      admin = await requireAdmin();
    } catch (e) {
      if (e instanceof AuthError) return errorResponse(e.status, e.message);
      throw e;
    }
    return handler(admin, ...args);
  };
}

/** First message per field, for showing next to form inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v?.[0] ?? "Invalid value"]));
}

/** Reads `?workspaceId=`. Returns null for the global scope, undefined if it is not a UUID. */
export function workspaceScope(request: Request): string | null | undefined {
  const id = new URL(request.url).searchParams.get("workspaceId");
  if (id === null) return null;
  return z.uuid().safeParse(id).success ? id : undefined;
}
