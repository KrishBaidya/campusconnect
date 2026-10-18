import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { discoverPeople, getViewer, type Scope } from "@/lib/people";
import { AppShell } from "@/components/aluminx/app-shell";
import { DiscoverView, ScopeSwitch, type DiscoverMode } from "@/components/aluminx/discover-view";
import { aiSearch, cofounders, reverseMentors } from "@/lib/match";
import { connectionStates } from "@/lib/network";
import type { PersonCard } from "@/lib/people";

export const metadata: Metadata = { title: "Discover · AluminX" };

export default function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  return (
    <Suspense fallback={<DiscoverSkeleton />}>
      <Discover searchParams={searchParams} />
    </Suspense>
  );
}

async function Discover({ searchParams }: Pick<PageProps<"/discover">, "searchParams">) {
  const user = await getUser();
  if (!user) redirect("/signin?next=/discover");

  const viewer = await getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined);
  if (!viewer.onboarded) redirect("/onboarding");

  const { scope: s, mode: m, q: rawQ } = await searchParams;
  // No college on file means there's nothing to scope to, so start Global.
  const scope: Scope = s === "global" || !viewer.collegeId ? "global" : "college";
  const mode: DiscoverMode = m === "ai" || m === "reverse" || m === "cofounder" ? m : "people";
  const q = typeof rawQ === "string" ? rawQ.trim().slice(0, 300) : "";

  let people: PersonCard[] = [];
  let aiError: string | null = null;
  if (mode === "people") people = await discoverPeople(viewer, scope);
  else if (mode === "reverse") people = await reverseMentors(viewer, scope);
  else if (mode === "cofounder") people = await cofounders(viewer, scope);
  else if (q) {
    const res = await aiSearch(viewer, scope, q);
    if (res.ok) people = res.people;
    else aiError = res.error;
  }
  const connections = await connectionStates(viewer.id, people.map((p) => p.id));

  return (
    <AppShell viewer={viewer} active="discover">
      <main className="main" style={{ maxWidth: 1080 }}>
        <div className="page-h">
          <h1>Discover</h1>
          <ScopeSwitch scope={scope} college={viewer.college} mode={mode} q={q || undefined} />
        </div>
        <DiscoverView
          key={`${scope}:${mode}:${q}`}
          people={people}
          connections={connections}
          scope={scope}
          mode={mode}
          aiQuery={q}
          aiError={aiError}
          college={viewer.college}
          myTags={viewer.tags}
        />
      </main>
    </AppShell>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="ax">
      <main className="main" style={{ maxWidth: 1080 }} aria-busy="true">
        <div className="page-h">
          <h1>Discover</h1>
        </div>
        <span className="skel" style={{ height: 56, borderRadius: 16, marginBottom: 16 }} />
        <p className="count">Searching…</p>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="drow" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
            <span className="skel" style={{ width: 40, height: 40, borderRadius: 12 }} />
            <div style={{ display: "grid", gap: 8 }}>
              <span className="skel" style={{ width: "36%", height: 12 }} />
              <span className="skel" style={{ width: "62%", height: 12 }} />
            </div>
            <span className="skel" style={{ width: 120, height: 32, borderRadius: 10 }} />
          </div>
        ))}
      </main>
    </div>
  );
}
