"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Globe, MessageCircle, Repeat, Rocket, Route, School, Search, SearchX, Sparkles, Users } from "lucide-react";
import type { PersonCard, Scope } from "@/lib/people";
import type { ConnState } from "@/lib/network";
import { fuzzyMatch, tokenize } from "@/lib/fuzzy";
import { GitHubMark, LinkedInMark } from "./brand-icons";
import { ConnectButton } from "./connect-button";
import { PersonNode } from "./person-node";

export type DiscoverMode = "people" | "ai" | "reverse" | "cofounder";

export const MODES: { key: DiscoverMode; label: string; Icon: typeof Users; blurb: string }[] = [
  { key: "people", label: "People", Icon: Users, blurb: "Everyone, ranked by how close they are to you." },
  { key: "ai", label: "Ask AI", Icon: Sparkles, blurb: "Describe who you need in plain words. Gemini finds people by meaning, not keywords." },
  { key: "reverse", label: "Reverse mentors", Icon: Repeat, blurb: "People, often juniors, whose skills cover what you’re curious about but don’t list yourself." },
  { key: "cofounder", label: "Co-founders", Icon: Rocket, blurb: "People looking for a co-founder whose skills fill your gaps and who care about the same things." },
];

const ROLES = [
  { key: "alumni", label: "Alumni" },
  { key: "student", label: "Students" },
] as const;

const JOBS = [
  { key: "referral", label: "Gives referrals" },
  { key: "internship", label: "Internships" },
] as const;

const CHIPS = 6;

type Props = {
  people: PersonCard[];
  connections: Record<string, ConnState>;
  scope: Scope;
  mode: DiscoverMode;
  /** the free-text query for Ask AI */
  aiQuery: string;
  aiError: string | null;
  college: string | null;
  /** the viewer's own interests/expertise, so their topics come first in the chip rail */
  myTags: string[];
};

/** Top `n` values by how many people have them; the viewer's own tags first. */
function topValues(people: PersonCard[], pick: (p: PersonCard) => string[], n: number, prefer = new Set<string>()) {
  const counts = new Map<string, { label: string; n: number }>();
  for (const p of people) {
    for (const v of new Set(pick(p).map((x) => x.trim()).filter(Boolean))) {
      const k = v.toLowerCase();
      const c = counts.get(k) ?? { label: v, n: 0 };
      c.n += 1;
      counts.set(k, c);
    }
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => Number(prefer.has(b)) - Number(prefer.has(a)) || y.n - x.n || x.label.localeCompare(y.label))
    .slice(0, n)
    .map(([key, { label }]) => ({ key, label }));
}

export function DiscoverView({ people, connections, scope, mode, aiQuery, aiError, college, myTags }: Props) {
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [mentor, setMentor] = useState(false);
  const [clubs, setClubs] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box, like the mockup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chips = useMemo(() => {
    const mine = new Set(myTags.map((t) => t.toLowerCase()));
    return {
      hobbies: topValues(people, (p) => p.interests, CHIPS, mine),
      clubs: topValues(people, (p) => p.clubs, CHIPS),
      companies: topValues(people, (p) => p.companies, CHIPS),
      jobs: JOBS.filter((j) => people.some((p) => p.intents.includes(j.key))),
      mentor: people.some((p) => p.intents.includes("mentor")),
    };
  }, [people, myTags]);

  // tokens per card, computed once for fuzzy search
  const words = useMemo(() => new Map(people.map((p) => [p.id, tokenize(p.keywords)])), [people]);

  // Switching scope swaps the chip rail; ignore picks whose chip is no longer shown.
  const live = <T extends { key: string }>(picked: string[], shown: readonly T[]) => picked.filter((k) => shown.some((c) => c.key === k));
  const aHobbies = live(hobbies, chips.hobbies);
  const aClubs = live(clubs, chips.clubs);
  const aCompanies = live(companies, chips.companies);
  const aJobs = live(jobs, chips.jobs);
  const aMentor = mentor && chips.mentor;

  const raw = query.trim();
  const has = (xs: string[], k: string) => xs.some((x) => x.toLowerCase() === k);
  // OR inside a group, AND across groups, so "Alumni + Students" means either.
  const shown = people.filter(
    (p) =>
      (roles.length === 0 || (p.role !== null && roles.includes(p.role))) &&
      (aHobbies.length === 0 || aHobbies.some((t) => has([...p.interests, ...p.expertise], t))) &&
      (aJobs.length === 0 || aJobs.some((j) => p.intents.includes(j))) &&
      (!aMentor || p.intents.includes("mentor")) &&
      (aClubs.length === 0 || aClubs.some((c) => has(p.clubs, c))) &&
      (aCompanies.length === 0 || aCompanies.some((c) => has(p.companies, c))) &&
      (!raw || fuzzyMatch(raw, p.keywords, words.get(p.id))),
  );

  const colleges = new Set(people.map((p) => p.college).filter(Boolean)).size;
  const where = scope === "global" ? `across ${colleges} ${colleges === 1 ? "college" : "colleges"}` : `at ${college ?? "your college"}`;
  const filtered = raw || roles.length || aHobbies.length || aJobs.length || aMentor || aClubs.length || aCompanies.length;
  const clear = () => {
    setQuery("");
    setRoles([]);
    setHobbies([]);
    setJobs([]);
    setMentor(false);
    setClubs([]);
    setCompanies([]);
  };
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, key: string) =>
    set((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const modeInfo = MODES.find((m) => m.key === mode)!;
  const qs = (m: DiscoverMode) => `/discover?${new URLSearchParams({ ...(scope === "global" ? { scope } : {}), ...(m === "people" ? {} : { mode: m }) })}`;

  return (
    <>
      <div className="modes" role="group" aria-label="Search mode">
        <div className="seg">
          {MODES.map(({ key, label, Icon }) => (
            <Link key={key} href={qs(key)} aria-current={mode === key}>
              <Icon className="ic" />
              {label}
            </Link>
          ))}
        </div>
      </div>
      {mode !== "people" && <p className="hint">{modeInfo.blurb}</p>}

      {mode === "ai" && (
        <form className="ai-row" action="/discover" method="get">
          {scope === "global" && <input type="hidden" name="scope" value="global" />}
          <input type="hidden" name="mode" value="ai" />
          <label className="cmd">
            <Sparkles className="ic" />
            <span className="sr">Describe who you&apos;re looking for</span>
            <input className="input" name="q" defaultValue={aiQuery} placeholder="e.g. alumni who moved from sales into fintech product" autoComplete="off" maxLength={300} />
          </label>
          <button type="submit" className="btn primary" style={{ height: 56, borderRadius: 16 }}>
            Search
          </button>
        </form>
      )}

      {(mode !== "ai" || people.length > 0) && (
        <>
          <label className="cmd">
            <Search className="ic" />
            <span className="sr">Filter people</span>
            <input
              ref={input}
              className="input"
              placeholder={mode === "ai" ? "Filter these results…" : "Search by name, company, club or skill. Typos are fine…"}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </label>

          <div className="frail">
            <span className="flabel">Who</span>
            {ROLES.map((r) => (
              <Chip key={r.key} on={roles.includes(r.key)} onClick={() => toggle(setRoles, r.key)}>
                {r.label}
              </Chip>
            ))}
            {chips.mentor && (
              <Chip on={mentor} onClick={() => setMentor(!mentor)}>
                Mentors
              </Chip>
            )}
            {chips.jobs.length > 0 && (
              <>
                <span className="sep" />
                <span className="flabel">Jobs &amp; placements</span>
                {chips.jobs.map((j) => (
                  <Chip key={j.key} on={jobs.includes(j.key)} onClick={() => toggle(setJobs, j.key)}>
                    {j.label}
                  </Chip>
                ))}
              </>
            )}
            {chips.hobbies.length > 0 && (
              <>
                <span className="sep" />
                <span className="flabel">Hobbies</span>
                {chips.hobbies.map((t) => (
                  <Chip key={t.key} on={hobbies.includes(t.key)} onClick={() => toggle(setHobbies, t.key)}>
                    {t.label}
                  </Chip>
                ))}
              </>
            )}
            {chips.clubs.length > 0 && (
              <>
                <span className="sep" />
                <span className="flabel">Clubs</span>
                {chips.clubs.map((c) => (
                  <Chip key={c.key} on={clubs.includes(c.key)} onClick={() => toggle(setClubs, c.key)}>
                    {c.label}
                  </Chip>
                ))}
              </>
            )}
            {chips.companies.length > 0 && (
              <>
                <span className="sep" />
                <span className="flabel">Companies</span>
                {chips.companies.map((c) => (
                  <Chip key={c.key} on={companies.includes(c.key)} onClick={() => toggle(setCompanies, c.key)}>
                    {c.label}
                  </Chip>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {aiError ? (
        <div className="empty">
          <SearchX className="ic" />
          <b>Couldn&apos;t run that search</b>
          <p>{aiError}</p>
        </div>
      ) : mode === "ai" && !aiQuery ? null : (
        <>
          <p className="count" aria-live="polite">
            {shown.length} {shown.length === 1 ? "person" : "people"} {where}
            {raw ? ` matching “${raw}”` : ""}
          </p>
          {shown.length > 0 ? (
            <div className="rows">
              {shown.map((p) => (
                <Row key={p.id} p={p} conn={connections[p.id]} mode={mode} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <SearchX className="ic" />
              <b>{emptyTitle(mode, people.length === 0, raw)}</b>
              <p>{emptyBody(mode, people.length === 0)}</p>
              <div className="btns">
                {filtered ? (
                  <button type="button" className="btn sm" onClick={clear}>
                    Clear filters
                  </button>
                ) : null}
                {scope === "college" && (
                  <Link className="btn sm" href={`/discover?${new URLSearchParams({ scope: "global", ...(mode === "people" ? {} : { mode }), ...(aiQuery ? { q: aiQuery } : {}) })}`}>
                    <Globe className="ic" />
                    Search Global
                  </Link>
                )}
                {(mode === "reverse" || mode === "cofounder") && people.length === 0 && (
                  <Link className="btn sm" href="/onboarding">
                    Update your profile
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function emptyTitle(mode: DiscoverMode, none: boolean, raw: string) {
  if (!none) return raw ? `No one matches “${raw}”` : "No one matches these filters";
  if (mode === "ai") return "No close matches";
  if (mode === "reverse") return "No reverse mentors yet";
  if (mode === "cofounder") return "No co-founder matches yet";
  return "No one here yet";
}

function emptyBody(mode: DiscoverMode, none: boolean) {
  if (!none) return "Try fewer filters, or look beyond your college.";
  if (mode === "ai") return "Try describing them differently, or search Global.";
  if (mode === "reverse") return "This works from your interests that aren’t also your skills. Add a few interests you want to learn.";
  if (mode === "cofounder") return "Nobody looking for a co-founder has skills you don’t already list. Try Global, or add more about what you can do.";
  return "People show up once they finish onboarding.";
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="tag sm" aria-pressed={on} onClick={onClick}>
      <Check className="ic" />
      {children}
    </button>
  );
}

function Row({ p, conn, mode }: { p: PersonCard; conn: ConnState | undefined; mode: DiscoverMode }) {
  return (
    <div className="drow">
      <Link href={`/profile/${p.id}`} tabIndex={-1} aria-hidden="true">
        <PersonNode person={p} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <div className="drow-n">
          <Link href={`/profile/${p.id}`} style={{ textDecoration: "none" }}>
            <b>{p.name}</b>
          </Link>
          {p.role === "alumni" && <span className="chip xs">alumni</span>}
          {p.intents.includes("mentor") && <span className="chip acc xs">mentor</span>}
          {p.intents.includes("referral") && <span className="chip ok xs">referrals</span>}
          {p.intents.includes("cofounder") && mode !== "cofounder" && <span className="chip warn xs">co-founder</span>}
          {p.points > 0 && <span className="chip xs num">{p.points} pts</span>}
        </div>
        <div className="drow-r">
          {p.title ?? "No headline yet"} {p.batch && <span className="dim">{p.batch}</span>}
        </div>
        {p.why && (
          <div className="drow-w">
            <Route className="ic" />
            {p.why}
          </div>
        )}
      </div>
      <div className="match" title={p.similarity !== null ? "Profile similarity from embeddings" : "Connected sources"}>
        {p.similarity !== null && <b className="num">{Math.round(Math.max(0, p.similarity) * 100)}%</b>}
        <span className="srcs">
          <span className={p.hasLinkedin ? "" : "off"} title={p.hasLinkedin ? "LinkedIn connected" : "No LinkedIn"}>
            <LinkedInMark />
          </span>
          <span className={p.hasGithub ? "" : "off"} style={{ color: "var(--gh)" }} title={p.hasGithub ? "GitHub connected" : "No GitHub"}>
            <GitHubMark />
          </span>
        </span>
      </div>
      <div className="drow-a">
        <Link className="btn sm icon ghost" href={`/profile/${p.id}`} aria-label={`Open ${p.name}'s profile`}>
          <ArrowUpRight className="ic" />
        </Link>
        <Link className="btn sm icon" href={`/messages?to=${p.id}`} aria-label={`Message ${p.name}`} title="Message">
          <MessageCircle className="ic" />
        </Link>
        {conn && <ConnectButton person={p} state={conn} size="sm" context={p.why ?? "Discover"} />}
      </div>
    </div>
  );
}

export function ScopeSwitch({ scope, college, mode, q }: { scope: Scope; college: string | null; mode: DiscoverMode; q?: string }) {
  const href = (s: Scope) => `/discover?${new URLSearchParams({ ...(s === "global" ? { scope: s } : {}), ...(mode === "people" ? {} : { mode }), ...(q ? { q } : {}) })}`;
  return (
    <div className={scope === "global" ? "scope g" : "scope"} role="group" aria-label="Scope">
      <Link href={href("college")} aria-current={scope === "college"} aria-disabled={!college} title={college ? undefined : "Finish onboarding to pick your college"}>
        <span className="sn">
          <School className="ic" />
        </span>
        {college ?? "My college"}
      </Link>
      <span className="srl">
        <i />
      </span>
      <Link href={href("global")} aria-current={scope === "global"}>
        <span className="sn">
          <Globe className="ic" />
        </span>
        Global
      </Link>
    </div>
  );
}
