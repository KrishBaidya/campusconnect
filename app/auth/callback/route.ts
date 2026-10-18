import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/** Supabase redirects here after Google sign-in and after linking GitHub. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${origin}/signin?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/signin?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/signin?error=${encodeURIComponent(error?.message ?? "auth_failed")}`);
  }

  // Only allow relative redirects (prevents open-redirects to other sites).
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Default: first-timers go to onboarding, everyone else to their profile.
  const profile = await prisma.profile.findUnique({
    where: { id: data.user.id },
    select: { onboardedAt: true },
  });
  return NextResponse.redirect(`${origin}${profile?.onboardedAt ? "/profile" : "/onboarding"}`);
}
