"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Globe, MessageCircle, Route, School, Search, SearchX } from "lucide-react";
import type { PersonCard, Scope } from "@/lib/people";
import { GitHubMark, LinkedInMark } from "./brand-icons";
import { PersonNode } from "./person-node";

const ROLES = [
  { key: "alumni", label: "Alumni" },
  { key: "student", label: "Students" },
] as const;

const INTENTS = [
  { key: "mentor", label: "Open to mentoring" },
  { key: "referral", label: "Gives referrals" },
  { key: "internship", label: "Internships" },
  { key: "cofounder", label: "Cofounder search" },
  { key: "collaborate", label: "Wants to collaborate" },
] as const;

const TOPIC_CHIPS = 6;

type Props = {
  people: PersonCard[];
  scope: Scope;
  college: string | null;
  /** the viewer's own interests/expertise, so their topics come first in the chip rail */
  myTags: string[];
};

export function DiscoverView({ people, scope, college, myTags }: Props) {
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [intents, setIntents] = useState<string[]>([]);
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

  // Topic chips: the most common tags in this scope, with ones you share ranked first.
  const topicChips = useMemo(() => {
    const mine = new Set(myTags.map((t) => t.toLowerCase()));
    const counts = new Map<string, { label: string; n: number }>();
    for (const p of people) {
      for (const t of new Set([...p.interests, ...p.expertise].map((x) => x.trim()).filter(Boolean))) {
        const k = t.toLowerCase();
        const c = counts.get(k) ?? { label: t, n: 0 };
        c.n += 1;
        counts.set(k, c);
      }
    }
    return [...counts.entries()]
      .sort(([a, x], [b, y]) => Number(mine.has(b)) - Number(mine.has(a)) || y.n - x.n || x.label.localeCompare(y.label))
      .slice(0, TOPIC_CHIPS)
      .map(([key, { label }]) => ({ key, label }));
  }, [people, myTags]);

  const intentChips = INTENTS.filter((i) => people.some((p) => p.intents.includes(i.key)));
  // Switching scope swaps the chip rail; drop picks whose chip is no longer shown.
  const activeTopics = topics.filter((t) => topicChips.some((c) => c.key === t));
  const activeIntents = intents.filter((i) => intentChips.some((c) => c.key === i));

  const raw = query.trim();
  const q = raw.toLowerCase();
  // OR inside a group, AND across groups, so "Alumni + Students" means either.
  const shown = people.filter(
    (p) =>
      (roles.length === 0 || (p.role !== null && roles.includes(p.role))) &&
      (activeTopics.length === 0 || activeTopics.some((t) => [...p.interests, ...p.expertise].some((x) => x.toLowerCase() === t))) &&
      (activeIntents.length === 0 || activeIntents.some((i) => p.intents.includes(i))) &&
      (!q || p.keywords.includes(q)),
  );

  const colleges = new Set(people.map((p) => p.college).filter(Boolean)).size;
  const where = scope === "global" ? `across ${colleges} ${colleges === 1 ? "college" : "colleges"}` : `at ${college ?? "your college"}`;
  const filtered = raw || roles.length || activeTopics.length || activeIntents.length;

  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, key: string) =>
    set((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <>
      <label className="cmd">
        <Search className="ic" />
        <span className="sr">Search people</span>
        <input
          ref={input}
          className="input"
          placeholder="Search by name, company or skill…"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </label>

      <div className="frail">
        {ROLES.map((r) => (
          <Chip key={r.key} on={roles.includes(r.key)} onClick={() => toggle(setRoles, r.key)}>
            {r.label}
          </Chip>
        ))}
        {topicChips.length > 0 && <span className="sep" />}
        {topicChips.map((t) => (
          <Chip key={t.key} on={topics.includes(t.key)} onClick={() => toggle(setTopics, t.key)}>
            {t.label}
          </Chip>
        ))}
        {intentChips.length > 0 && <span className="sep" />}
        {intentChips.map((i) => (
          <Chip key={i.key} on={intents.includes(i.key)} onClick={() => toggle(setIntents, i.key)}>
            {i.label}
          </Chip>
        ))}
      </div>

      <p className="count" aria-live="polite">
        {shown.length} {shown.length === 1 ? "person" : "people"} {where}
        {raw ? ` matching “${raw}”` : ""}
      </p>

      {shown.length > 0 ? (
        <div className="rows">
          {shown.map((p) => (
            <Row key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <SearchX className="ic" />
          <b>{people.length === 0 ? "No one here yet" : raw ? `No one matches “${raw}”` : "No one matches these filters"}</b>
          <p>
            {people.length === 0
              ? "People show up once they finish onboarding."
              : "Try fewer filters, or look beyond your college."}
          </p>
          <div className="btns">
            {filtered ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setQuery("");
                  setRoles([]);
                  setTopics([]);
                  setIntents([]);
                }}
              >
                Clear filters
              </button>
            ) : null}
            {scope === "college" && (
              <Link className="btn sm" href="/discover?scope=global">
                <Globe className="ic" />
                Search Global
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="tag sm" aria-pressed={on} onClick={onClick}>
      <Check className="ic" />
      {children}
    </button>
  );
}

function Row({ p }: { p: PersonCard }) {
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
        <Link className="btn sm" href={`/messages?to=${p.id}`}>
          <MessageCircle className="ic" />
          Message
        </Link>
      </div>
    </div>
  );
}

export function ScopeSwitch({ scope, college }: { scope: Scope; college: string | null }) {
  return (
    <div className={scope === "global" ? "scope g" : "scope"} role="group" aria-label="Scope">
      <Link
        href="/discover"
        aria-current={scope === "college"}
        aria-disabled={!college}
        title={college ? undefined : "Finish onboarding to pick your college"}
      >
        <span className="sn">
          <School className="ic" />
        </span>
        {college ?? "My college"}
      </Link>
      <span className="srl">
        <i />
      </span>
      <Link href="/discover?scope=global" aria-current={scope === "global"}>
        <span className="sn">
          <Globe className="ic" />
        </span>
        Global
      </Link>
    </div>
  );
}
