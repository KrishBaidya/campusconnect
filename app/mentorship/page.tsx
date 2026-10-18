import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getViewer } from "@/lib/people";
import { getMentorship } from "@/lib/mentorship";
import { AppShell } from "@/components/aluminx/app-shell";
import { MentorshipView } from "@/components/aluminx/mentorship-view";
import "@/components/aluminx/aluminx.css";

export const metadata: Metadata = { title: "Mentorship · AluminX" };

export default function MentorshipPage() {
  return (
    <Suspense fallback={<MentorshipSkeleton />}>
      <Mentorship />
    </Suspense>
  );
}

async function Mentorship() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/mentorship");

  const viewer = await getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined);
  if (!viewer.onboarded) redirect("/onboarding");
  const data = await getMentorship(user.id);

  return (
    <AppShell viewer={viewer} active="mentorship">
      <MentorshipView data={data} me={{ initials: viewer.initials }} />
    </AppShell>
  );
}

function MentorshipSkeleton() {
  return (
    <div className="ax">
      <main className="main" aria-busy="true">
        <div className="page-h">
          <h1>Mentorship</h1>
        </div>
        <span className="skel" style={{ height: 46, marginBottom: 20 }} />
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} className="skel" style={{ height: 180, borderRadius: 20, marginBottom: 16 }} />
        ))}
      </main>
    </div>
  );
}
