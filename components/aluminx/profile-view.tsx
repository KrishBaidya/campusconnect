"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, Clock, FolderGit2, GraduationCap, MessageCircle, Pencil, Route } from "lucide-react";
import { hueOf } from "@/lib/hue";
import type { PersonProfile } from "@/lib/people";
import { GitHubMark, LinkedInMark } from "./brand-icons";
import { PersonNode } from "./person-node";

const INTENT_LABELS: Record<string, string> = {
  mentor: "Mentoring",
  mentee: "Finding a mentor",
  referral: "Referrals",
  cofounder: "Finding a cofounder",
  investor: "Investing",
  internship: "Internships",
  collaborate: "Collaborating",
};

/** Profile A from the mockups: source hub header, identity row, meta line, Overview / Projects tabs. */
export function ProfileView({ person, isMe }: { person: PersonProfile; isMe: boolean }) {
  const [tab, setTab] = useState<"overview" | "projects">("overview");
  const first = person.name.split(" ")[0];
  const shared = new Set(person.shared.map((t) => t.toLowerCase()));
  const roleLabel = person.role === "alumni" ? "Alumni" : person.role === "student" ? "Student" : null;

  return (
    <main className="main" style={{ maxWidth: 1120 }}>
      <SourceHub person={person} />

      <div className="pid">
        <div className="who">
          <h1>{person.name}</h1>
          <p>{person.headline ?? person.title ?? "No headline yet."}</p>
        </div>
        <div className="btns">
          {isMe ? (
            <Link className="btn primary" href="/onboarding">
              <Pencil className="ic" />
              Edit profile
            </Link>
          ) : (
            <Link className="btn primary" href={`/messages?to=${person.id}`}>
              <MessageCircle className="ic" />
              Message
            </Link>
          )}
          {person.linkedinUrl && (
            <a className="btn" href={person.linkedinUrl} target="_blank" rel="noreferrer">
              <LinkedInMark className="ic" />
              LinkedIn
            </a>
          )}
          {person.githubUrl && (
            <a className="btn" href={person.githubUrl} target="_blank" rel="noreferrer">
              <GitHubMark className="ic" />
              GitHub
            </a>
          )}
        </div>
      </div>

      <div className="pmeta">
        {(roleLabel || person.batch) && (
          <span>
            <GraduationCap className="ic" />
            {[roleLabel, person.batch].filter(Boolean).join(", ")}
          </span>
        )}
        {person.department && (
          <span>
            <Briefcase className="ic" />
            {person.department}
          </span>
        )}
        {person.shared.length > 0 && (
          <span>
            <Route className="ic" />
            You share {person.shared.length} {person.shared.length === 1 ? "interest" : "interests"}
          </span>
        )}
        {person.availability && (
          <span>
            <Clock className="ic" />
            {person.availability}
          </span>
        )}
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 18 }}>
        <button role="tab" id="tab-overview" aria-controls="panel-overview" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button role="tab" id="tab-projects" aria-controls="panel-projects" aria-selected={tab === "projects"} onClick={() => setTab("projects")}>
          Projects<span className="chip xs num">{person.projects.length}</span>
        </button>
      </div>

      {tab === "overview" ? (
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="pgrid">
          <div className="col">
            <div className="sec">
              <h3>About</h3>
              <p>{person.bio ?? (isMe ? "Add a short bio by re-running profile setup." : `${first} hasn't written a bio yet.`)}</p>
            </div>
            <div className="sec">
              <h3>Experience</h3>
              {person.experiences.length === 0 ? (
                <p className="dim">No experience listed.</p>
              ) : (
                <div className="tl">
                  {person.experiences.map((e, i) => (
                    <div className="tl-i" key={`${e.company}-${i}`}>
                      <PersonNode person={{ name: e.company, initials: initials(e.company), hue: hueOf(e.company), avatarUrl: null }} />
                      <div>
                        <b>{e.jobRole ?? e.company}</b>
                        <small>
                          {e.jobRole ? e.company : null}
                          {e.start || e.current ? `${e.jobRole ? ". " : ""}${e.start ?? "?"} to ${e.current ? "now" : (e.end ?? "?")}` : null}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="col">
            <TagSection title="Expertise" tags={person.expertise} shared={shared} />
            <TagSection title="Interests" tags={person.interests} shared={shared} />
            {person.intents.length > 0 && (
              <div className="sec">
                <h3>Here to</h3>
                <div className="tags">
                  {person.intents.map((i) => (
                    <span key={i} className="chip acc">
                      {INTENT_LABELS[i] ?? i}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="panel-projects" aria-labelledby="tab-projects">
          {person.projects.length === 0 ? (
            <div className="empty">
              <FolderGit2 className="ic" />
              <b>No projects yet</b>
              <p>{isMe ? "Connect GitHub during profile setup to pull in your repos." : `${first} hasn't shared any projects.`}</p>
            </div>
          ) : (
            <div className="repos">
              {person.projects.map((p) => {
                const body = (
                  <>
                    <b>{p.name}</b>
                    {p.description && <p>{p.description}</p>}
                    {p.tech.length > 0 && (
                      <div className="rm">
                        {p.tech.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                  </>
                );
                return p.url ? (
                  <a key={p.name} className="repo" href={p.url} target="_blank" rel="noreferrer">
                    {body}
                  </a>
                ) : (
                  <div key={p.name} className="repo">
                    {body}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/** Header band: their LinkedIn and GitHub wired into them by rails. Unlinked sources sit dimmed. */
function SourceHub({ person }: { person: PersonProfile }) {
  return (
    <div className="phub" style={{ "--h": person.hue } as React.CSSProperties} aria-label="Connected sources">
      <span className={person.hasLinkedin ? "pr l" : "pr l off"}>{person.hasLinkedin && <i />}</span>
      <span className={person.hasGithub ? "pr g" : "pr g off"}>{person.hasGithub && <i />}</span>
      <SourceNode href={person.linkedinUrl} side="l" label="LinkedIn">
        <LinkedInMark />
      </SourceNode>
      <SourceNode href={person.githubUrl} side="g" label="GitHub">
        <GitHubMark />
      </SourceNode>
      <span className="pl l">{person.hasLinkedin ? "LinkedIn · live" : "LinkedIn · not linked"}</span>
      <span className="pl g">{person.githubUsername ? `@${person.githubUsername}` : person.hasGithub ? "GitHub · live" : "GitHub · not linked"}</span>
      <PersonNode person={person} size="xl" />
    </div>
  );
}

function SourceNode({ href, side, label, children }: { href: string | null; side: "l" | "g"; label: string; children: React.ReactNode }) {
  const cls = `ps ${side}${href ? "" : " off"}`;
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}>
      {children}
    </a>
  ) : (
    <span className={cls} title={`${label} not linked`}>
      {children}
    </span>
  );
}

function TagSection({ title, tags, shared }: { title: string; tags: string[]; shared: Set<string> }) {
  if (tags.length === 0) return null;
  return (
    <div className="sec">
      <h3>{title}</h3>
      <div className="tags">
        {tags.map((t) => (
          <span key={t} className={shared.has(t.toLowerCase()) ? "tag sm static shared" : "tag sm static"} title={shared.has(t.toLowerCase()) ? "You share this" : undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function initials(company: string) {
  const words = company.split(/[\s&.-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : company.slice(0, 2)).toUpperCase();
}
