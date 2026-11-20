import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

const PUBLIC_PAGES = ["/login"];
const isPublicPage = (pathname: string) => PUBLIC_PAGES.includes(pathname) || pathname.startsWith("/book/");

/** Refreshes the Supabase session cookie and sends signed-out visitors to /login. API routes check auth themselves. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (!data?.claims && !isApi && !isPublicPage(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
