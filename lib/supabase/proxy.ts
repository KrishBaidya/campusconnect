import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Pages that need a signed-in user. Everything else is public. */
const PROTECTED = ["/onboarding", "/profile", "/api/profile", "/messages", "/discover"];

/** Refreshes the Supabase session cookie on every request and guards protected pages. */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => supabaseResponse.headers.set(k, v as string));
        },
      },
    },
  );

  // Do not remove: this refreshes the auth token. Nothing may run between createServerClient and getClaims.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const path = request.nextUrl.pathname;
  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
