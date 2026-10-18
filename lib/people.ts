import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { hueOf } from "@/lib/hue";

// Read models for Discover and the profile pages. Everything here runs with
// Prisma (server role), so callers must already have checked the session.

export type Scope = "college" | "global";

export type Project = { name: string; description: string; url: string | null; tech: string[] };

export type PersonCard = {
  id: string;
  name: string;
  initials: string;
  hue: number;
  avatarUrl: string | null;
  role: "student" | "alumni" | null;
  headline: string | null;
  /** "Product Lead, Razorpay" from the current job, else the headline */
  title: string | null;
  /** "2016, BIMTECH" */
  batch: string | null;
  college: string | null;
  interests: string[];
  expertise: string[];
  intents: string[];
  hasGithub: boolean;
  hasLinkedin: boolean;
  /** one line on why this person showed up for you */
  why: string | null;
  /** cosine similarity from match_profiles, when embeddings exist */
  similarity: number | null;
  /** lowercased text the search box matches against */
  keywords: string;
  /** every company in their work history, current first ("company tags") */
  companies: string[];
  clubs: string[];
  points: number;
};

export type PersonProfile = PersonCard & {
  bio: string | null;
  department: string | null;
  batchYear: number | null;
  availability: string | null;
  githubUrl: string | null;
  githubUsername: string | null;
  linkedinUrl: string | null;
  projects: Project[];
  experiences: { company: string; jobRole: string | null; start: string | null; end: string | null; current: boolean }[];
  /** interests/expertise you both list (empty on your own profile) */
  shared: string[];
  connections: number;
};

export type Viewer = {
  id: string;
  name: string;
  initials: string;
  role: "student" | "alumni" | null;
  collegeId: string | null;
  college: string | null;
  tags: string[];
  hasGithub: boolean;
  hasLinkedin: boolean;
  onboarded: boolean;
  points: number;
  /** badges on the rail nav */
  counts: { unreadMessages: number; pendingMentorship: number; pendingConnections: number };
};

export const cardInclude = {
  college: { select: { name: true } },
  experiences: { orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }] },
  clubs: { select: { club: { select: { name: true } } } },
} satisfies Prisma.ProfileInclude;

const include = cardInclude;
type Row = Prisma.ProfileGetPayload<{ include: typeof include }>;

export function fullName(p: { firstName: string | null; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Unnamed member";
}

function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || name === "Unnamed member") return "?";
  return parts.map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const year = (d: Date | null) => (d ? d.getUTCFullYear() : null);

export function toCard(p: Row, mine: Set<string>, similarity: number | null): PersonCard {
  const name = fullName(p);
  const job = p.experiences[0];
  const title = job ? [job.jobRole, job.company].filter(Boolean).join(", ") : p.headline;
  const batch = [p.batchYear ? `${p.role === "student" ? "Class of " : ""}${p.batchYear}` : null, p.college?.name]
    .filter(Boolean)
    .join(", ");
  const tags = [...p.interests, ...p.expertise];
  const shared = [...new Set(tags.filter((t) => mine.has(t.toLowerCase())))];

  let why: string | null = null;
  if (shared.length > 0) why = `Shares ${listOf(shared.slice(0, 2))}${shared.length > 2 ? ` and ${shared.length - 2} more` : ""}.`;
  else if (similarity !== null && similarity > 0.6) why = "Close match to your profile.";
  else if (p.headline && p.headline !== title) why = p.headline;

  return {
    id: p.id,
    name,
    initials: initialsOf(name),
    hue: hueOf(p.id),
    avatarUrl: p.avatarUrl,
    role: p.role,
    headline: p.headline,
    title: title || null,
    batch: batch || null,
    college: p.college?.name ?? null,
    interests: p.interests,
    expertise: p.expertise,
    intents: p.intents,
    hasGithub: Boolean(p.githubUsername || p.githubUrl),
    hasLinkedin: Boolean(p.linkedinUrl),
    why,
    similarity,
    companies: [...new Set(p.experiences.map((e) => e.company.trim()).filter(Boolean))],
    clubs: p.clubs.map((c) => c.club.name),
    points: p.points,
    keywords: [name, p.headline, p.department, p.college?.name, ...p.experiences.flatMap((e) => [e.company, e.jobRole]), ...p.clubs.map((c) => c.club.name), ...tags]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function listOf(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export async function getViewer(userId: string, fallbackName?: string | null): Promise<Viewer> {
  const [p, unreadMessages, pendingMentorship, pendingConnections] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, include: { college: { select: { name: true } } } }),
    prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: { OR: [{ userAId: userId }, { userBId: userId }] },
      },
    }),
    prisma.mentorshipRequest.count({ where: { mentorId: userId, status: "pending" } }),
    prisma.connection.count({ where: { addresseeId: userId, status: "pending" } }),
  ]);
  const own = p ? fullName(p) : "Unnamed member";
  const name = own === "Unnamed member" && fallbackName ? fallbackName : own;
  return {
    id: userId,
    name,
    initials: initialsOf(name),
    role: p?.role ?? null,
    collegeId: p?.collegeId ?? null,
    college: p?.college?.name ?? null,
    tags: p ? [...p.interests, ...p.expertise] : [],
    hasGithub: Boolean(p?.githubUsername || p?.githubUrl),
    hasLinkedin: Boolean(p?.linkedinUrl),
    onboarded: Boolean(p?.onboardedAt),
    points: p?.points ?? 0,
    counts: { unreadMessages, pendingMentorship, pendingConnections },
  };
}

/**
 * Similarity scores from match_profiles (3_match_profiles migration). Empty when
 * the viewer has no embedding yet or the function isn't deployed, so Discover
 * still works and just falls back to shared-tag ordering.
 */
async function similarities(userId: string, scope: Scope, limit: number) {
  try {
    const rows = await prisma.$queryRaw<{ profile_id: string; similarity: number }[]>`
      select profile_id, similarity from public.match_profiles(${userId}::uuid, ${scope === "college" ? "college" : "global"}, ${limit}::int)`;
    return new Map(rows.map((r) => [r.profile_id, Number(r.similarity)]));
  } catch (e) {
    console.warn("match_profiles unavailable, ordering Discover without embeddings:", e);
    return new Map<string, number>();
  }
}

const DISCOVER_LIMIT = 200;

export async function discoverPeople(viewer: Viewer, scope: Scope): Promise<PersonCard[]> {
  if (scope === "college" && !viewer.collegeId) return [];
  const where: Prisma.ProfileWhereInput = {
    id: { not: viewer.id },
    onboardedAt: { not: null },
    ...(scope === "college" ? { collegeId: viewer.collegeId } : {}),
  };

  const [rows, sims] = await Promise.all([
    prisma.profile.findMany({ where, include, orderBy: { onboardedAt: "desc" }, take: DISCOVER_LIMIT }),
    similarities(viewer.id, scope, DISCOVER_LIMIT),
  ]);

  const mine = new Set(viewer.tags.map((t) => t.toLowerCase()));
  const cards = rows.map((r) => toCard(r, mine, sims.get(r.id) ?? null));
  const sharedCount = (c: PersonCard) => [...c.interests, ...c.expertise].filter((t) => mine.has(t.toLowerCase())).length;

  return cards.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || sharedCount(b) - sharedCount(a));
}

const AVAILABILITY: Record<string, string> = {
  weekdays: "Weekdays",
  weekends: "Weekends",
  evenings: "Evenings",
  flexible: "Flexible",
  none: "Not taking requests right now",
};

function availabilityOf(v: Prisma.JsonValue | null) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const pref = (v as Record<string, unknown>).preference;
  return typeof pref === "string" ? (AVAILABILITY[pref] ?? pref) : null;
}

function projectsOf(v: Prisma.JsonValue): Project[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return [];
    const o = p as Record<string, unknown>;
    if (typeof o.name !== "string") return [];
    return [
      {
        name: o.name,
        description: typeof o.description === "string" ? o.description : "",
        url: typeof o.url === "string" ? o.url : null,
        tech: Array.isArray(o.tech) ? o.tech.filter((t): t is string => typeof t === "string") : [],
      },
    ];
  });
}

export async function getPerson(id: string, viewer: Viewer): Promise<PersonProfile | null> {
  const [p, connections] = await Promise.all([
    prisma.profile.findUnique({ where: { id }, include }),
    prisma.connection.count({ where: { status: "accepted", OR: [{ requesterId: id }, { addresseeId: id }] } }),
  ]);
  if (!p || !p.onboardedAt) return null;

  const isMe = id === viewer.id;
  const mine = new Set(isMe ? [] : viewer.tags.map((t) => t.toLowerCase()));
  const card = toCard(p, mine, null);

  return {
    ...card,
    bio: p.bio,
    department: p.department,
    batchYear: p.batchYear,
    availability: availabilityOf(p.availability),
    githubUrl: p.githubUrl ?? (p.githubUsername ? `https://github.com/${p.githubUsername}` : null),
    githubUsername: p.githubUsername,
    linkedinUrl: p.linkedinUrl,
    projects: projectsOf(p.projects),
    experiences: p.experiences.map((e) => ({
      company: e.company,
      jobRole: e.jobRole,
      start: year(e.startDate)?.toString() ?? null,
      end: year(e.endDate)?.toString() ?? null,
      current: e.endDate === null,
    })),
    shared: [...new Set([...p.interests, ...p.expertise].filter((t) => mine.has(t.toLowerCase())))],
    connections,
  };
}

/** Cosine similarity of two people's embeddings (0..1), or null if either isn't embedded yet. */
export async function similarityBetween(a: string, b: string): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<{ s: number | null }[]>`select public.profile_similarity(${a}::uuid, ${b}::uuid) as s`;
    const s = rows[0]?.s;
    return s === null || s === undefined ? null : Number(s);
  } catch (e) {
    console.warn("profile_similarity unavailable:", e);
    return null;
  }
}
