import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { discoverPeople, getViewer, type Scope } from "@/lib/people";
import { AppShell } from "@/components/aluminx/app-shell";
import { DiscoverView, ScopeSwitch } from "@/components/aluminx/discover-view";

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

  const { scope: s } = await searchParams;
  // No college on file means there's nothing to scope to, so start Global.
  const scope: Scope = s === "global" || !viewer.collegeId ? "global" : "college";
  const people = await discoverPeople(viewer, scope);

  return (
    <AppShell viewer={viewer} active="discover">
      <main className="main" style={{ maxWidth: 1080 }}>
        <div className="page-h">
          <h1>Discover</h1>
          <ScopeSwitch scope={scope} college={viewer.college} />
        </div>
        <DiscoverView people={people} scope={scope} college={viewer.college} myTags={viewer.tags} />
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
