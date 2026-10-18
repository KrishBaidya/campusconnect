import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { githubUsernameOf } from "@/lib/profile/github-identity";
import { OnboardingForm } from "@/components/onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Profile setup</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Let’s build your profile</h1>
        <p className="text-muted-foreground">
          Connect GitHub and add your LinkedIn PDF. Gemini reads both and drafts your profile — you can edit it after.
        </p>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  const user = await getUser();
  if (!user) redirect("/signin");

  const [profile, colleges] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true, batchYear: true, department: true, intents: true, linkedinUrl: true, college: { select: { name: true } } },
    }),
    prisma.college.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);

  const fullName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? "") as string;

  return (
    <OnboardingForm
      githubUsername={githubUsernameOf(user)}
      initials={fullName.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join("") || "?"}
      colleges={colleges.map((c) => c.name)}
      defaults={{
        role: profile?.role ?? null,
        college: profile?.college?.name ?? "",
        batchYear: profile?.batchYear ? String(profile.batchYear) : "",
        department: profile?.department ?? "",
        intents: profile?.intents ?? [],
        linkedinUrl: profile?.linkedinUrl ?? "",
      }}
    />
  );
}
