import "./aluminx.css";
import Link from "next/link";
import { Compass, Handshake, House, LogOut, MessagesSquare, UserRound } from "lucide-react";
import type { Viewer } from "@/lib/people";
import { GitHubMark, LinkedInMark } from "./brand-icons";

const NAV = [
  { key: "home", href: "/", label: "Home", Icon: House },
  { key: "discover", href: "/discover", label: "Discover", Icon: Compass },
  { key: "messages", href: "/messages", label: "Messages", Icon: MessagesSquare },
  { key: "mentorship", href: "/mentorship", label: "Mentorship", Icon: Handshake },
  { key: "profile", href: "/profile", label: "Profile", Icon: UserRound },
] as const;

export type NavKey = (typeof NAV)[number]["key"];

/** The rail-nav shell from the AluminX mockups. `active` lights the rail up to that item. */
export function AppShell({ viewer, active, aside, children }: { viewer: Viewer; active: NavKey | null; aside?: React.ReactNode; children: React.ReactNode }) {
  const ai = Math.max(0, NAV.findIndex((n) => n.key === active));
  const counts: Partial<Record<NavKey, number>> = {
    home: viewer.counts.pendingConnections,
    messages: viewer.counts.unreadMessages,
    mentorship: viewer.counts.pendingMentorship,
  };

  return (
    <div className="ax">
      <div className={aside ? "shell three" : "shell"}>
        <nav className="rnav" aria-label="App">
          <Link href="/profile" className="rnav-me">
            <span className="node you">{viewer.initials}</span>
            <div>
              <b>{viewer.name}</b>
              <span className="chip acc num">
                {viewer.points} pts
              </span>
            </div>
          </Link>
          <div className="rnav-rail" style={{ "--ai": ai } as React.CSSProperties}>
            {active && <span className="rnav-pk" />}
            {NAV.map(({ key, href, label, Icon }) => (
              <Link key={key} href={href} className="rn" aria-current={key === active ? "page" : undefined} aria-label={counts[key] ? `${label}, ${counts[key]} new` : label}>
                <span className="rn-n">
                  <Icon className="ic" />
                </span>
                <span className="rn-l">{label}</span>
                {counts[key] ? (
                  <span className="cnt num" aria-hidden="true">
                    {counts[key]}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
          <div className="rnav-foot">
            <div>
              <LinkedInMark className="ic" style={{ fontSize: 14 }} />
              LinkedIn
              <span className={viewer.hasLinkedin ? "chip ok" : "chip"}>{viewer.hasLinkedin ? "live" : "off"}</span>
            </div>
            <div>
              <GitHubMark className="ic" style={{ fontSize: 14, color: "var(--gh)" }} />
              GitHub
              <span className={viewer.hasGithub ? "chip ok" : "chip"}>{viewer.hasGithub ? "live" : "off"}</span>
            </div>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn ghost sm" style={{ paddingInline: 0 }}>
                <LogOut className="ic" />
                Sign out
              </button>
            </form>
          </div>
        </nav>
        {children}
        {aside}
      </div>
    </div>
  );
}
