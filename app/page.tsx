import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { fullName, getViewer, type Viewer } from "@/lib/people";
import { getFeed, suggestions, type FeedScope } from "@/lib/feed";
import { incomingRequests } from "@/lib/network";
import { leaderboard, rankOf } from "@/lib/points";
import { POINTS } from "@/lib/points-shared";
import { hueOf } from "@/lib/hue";
import { AppShell } from "@/components/aluminx/app-shell";
import { HomeFeed } from "@/components/aluminx/home-feed";
import { ConnectButton } from "@/components/aluminx/connect-button";
import { PersonNode } from "@/components/aluminx/person-node";
import "@/components/aluminx/aluminx.css";

export const metadata: Metadata = { title: "AluminX" };

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const user = await getUser();
  if (!user) return <Landing />;

  const viewer = await getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined);
  if (!viewer.onboarded) redirect("/onboarding");

  const { scope: s } = await searchParams;
  const scope: FeedScope = s === "college" || s === "global" ? s : "foryou";
  const feed = await getFeed(viewer, scope);

  return (
    <AppShell viewer={viewer} active="home" aside={<HomeAside viewer={viewer} scope={scope} />}>
      <HomeFeed feed={feed} scope={scope} college={viewer.college} me={{ id: viewer.id, initials: viewer.initials }} />
    </AppShell>
  );
}

async function HomeAside({ viewer, scope }: { viewer: Viewer; scope: FeedScope }) {
  const board = scope === "global" ? null : viewer.collegeId;
  const [incoming, people, top, rank] = await Promise.all([
    incomingRequests(viewer.id, 5),
    suggestions(viewer, 4),
    leaderboard(board, 5),
    rankOf(viewer.points, board),
  ]);

  return (
    <aside className="aside">
      <div className="pts">
        <h3>
          Your points
          <span className="chip acc">
            <Trophy className="ic" style={{ fontSize: 13 }} />#{rank} {board ? "at your college" : "overall"}
          </span>
        </h3>
        <b className="num">{viewer.points}</b>
        <span className="dim" style={{ fontSize: 13 }}>
          Earn points by helping people. Alumni who reply and mentor rise to the top.
        </span>
      </div>

      {incoming.length > 0 && (
        <div>
          <h3>
            Handshakes<span className="chip warn num">{incoming.length}</span>
          </h3>
          <div className="stack">
            {incoming.map((c) => {
              const p = { id: c.requester.id, name: fullName(c.requester), hue: hueOf(c.requester.id), avatarUrl: c.requester.avatarUrl, initials: initialsOf(fullName(c.requester)) };
              return (
                <div key={c.id} className="person">
                  <PersonNode person={p} size="sm" />
                  <div>
                    <Link href={`/profile/${p.id}`} style={{ textDecoration: "none" }}>
                      <b>{p.name}</b>
                    </Link>
                    <small title={c.message ?? undefined}>{c.message ?? c.requester.headline ?? "wants to connect"}</small>
                  </div>
                  <ConnectButton person={p} state={{ status: "incoming", id: c.id, since: c.createdAt.toISOString(), message: c.message }} size="icon" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {people.length > 0 && (
        <div>
          <h3>
            People you may know
            <Link className="btn ghost sm" href="/discover">
              See all
            </Link>
          </h3>
          <div className="stack">
            {people.map((p) => (
              <div key={p.id} className="person">
                <PersonNode person={p} size="sm" />
                <div>
                  <Link href={`/profile/${p.id}`} style={{ textDecoration: "none" }}>
                    <b>{p.name}</b>
                  </Link>
                  <small>{p.line ?? "AluminX member"}</small>
                </div>
                <ConnectButton person={p} state={{ status: "none" }} size="icon" context="People you may know" />
              </div>
            ))}
          </div>
        </div>
      )}

      {top.length > 0 && (
        <div>
          <h3>Leaderboard</h3>
          <div className="lb">
            {top.map((p, i) => {
              const name = fullName(p);
              return (
                <div key={p.id} className="person">
                  <span className="rank">{i + 1}</span>
                  <PersonNode person={{ name, initials: initialsOf(name), hue: hueOf(p.id), avatarUrl: p.avatarUrl }} size="sm" />
                  <div>
                    <Link href={p.id === viewer.id ? "/profile" : `/profile/${p.id}`} style={{ textDecoration: "none" }}>
                      <b>{p.id === viewer.id ? "You" : name}</b>
                    </Link>
                  </div>
                  <span className="p num">{p.points}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3>How points work</h3>
        <div className="rules">
          {Object.values(POINTS).map((r) => (
            <div key={r.label}>
              <span>{r.label}</span>
              <span>+{r.points}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function initialsOf(name: string) {
  return name === "Unnamed member"
    ? "?"
    : name
        .split(/\s+/)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function Landing() {
  return (
    <div className="ax" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <main style={{ maxWidth: 560, display: "grid", gap: 20, textAlign: "center", justifyItems: "center" }}>
        <span className="node you lg">=</span>
        <h1 style={{ fontSize: 40, lineHeight: 1.1 }}>Meet the alumni who&apos;ve done what you want to do</h1>
        <p className="muted" style={{ fontSize: 17 }}>
          AluminX matches students and alumni by intent, not follower count. Start with your own college, then go global.
        </p>
        <Link className="btn primary" href="/signin">
          Sign in to get started
        </Link>
      </main>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="ax">
      <main className="main" style={{ maxWidth: 820 }} aria-busy="true">
        <div className="feed-h">
          <h1>Home</h1>
        </div>
        <span className="skel" style={{ height: 88, borderRadius: 16, marginBottom: 32 }} />
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="skel" style={{ height: 140, borderRadius: 16, marginBottom: 24 }} />
        ))}
      </main>
    </div>
  );
}
