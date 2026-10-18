import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { embed } from "@/lib/ai/gemini";
import { cardInclude, toCard, type PersonCard, type Scope, type Viewer } from "@/lib/people";

// The three "smart" Discover modes from the spec: free-text search (Gemini
// embeddings + pgvector), the reverse mentor finder, and co-founder matching
// by complementary skills.

const LIMIT = 30;

const norm = (t: string) => t.trim().toLowerCase();
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

async function me(viewerId: string) {
  return prisma.profile.findUniqueOrThrow({
    where: { id: viewerId },
    select: { interests: true, expertise: true, collegeId: true, batchYear: true, role: true },
  });
}

function scopeWhere(viewer: Viewer, scope: Scope): Prisma.ProfileWhereInput {
  return {
    id: { not: viewer.id },
    onboardedAt: { not: null },
    ...(scope === "college" && viewer.collegeId ? { collegeId: viewer.collegeId } : {}),
  };
}

/** Similarity to the viewer for a set of people, from match_profiles. Empty if embeddings aren't there yet. */
async function similarities(userId: string, scope: Scope) {
  try {
    const rows = await prisma.$queryRaw<{ profile_id: string; similarity: number }[]>`
      select profile_id, similarity from public.match_profiles(${userId}::uuid, ${scope}, 200::int)`;
    return new Map(rows.map((r) => [r.profile_id, Number(r.similarity)]));
  } catch {
    return new Map<string, number>();
  }
}

/* ---------------------------- 1. free-text search ---------------------------- */

export type AiSearchResult = { ok: true; people: PersonCard[] } | { ok: false; error: string };

/** "someone who moved from sales to product in fintech" -> closest profiles by meaning, not keywords. */
export async function aiSearch(viewer: Viewer, scope: Scope, query: string): Promise<AiSearchResult> {
  const q = query.trim().slice(0, 300);
  if (q.length < 3) return { ok: false, error: "Describe who you’re looking for in a few words." };

  let vector: number[];
  try {
    vector = await embed(`Looking for: ${q}`);
  } catch (e) {
    console.error("Search embedding failed:", e);
    return { ok: false, error: "AI search is unavailable right now (check GEMINI_API_KEY). Try the regular search." };
  }

  let rows: { profile_id: string; similarity: number }[];
  try {
    rows = await prisma.$queryRaw`
      select profile_id, similarity
      from public.search_profiles_by_vector(${`[${vector.join(",")}]`}::extensions.vector, ${viewer.id}::uuid, ${scope}, ${LIMIT}::int)`;
  } catch (e) {
    console.error("search_profiles_by_vector failed:", e);
    return { ok: false, error: "AI search needs the 5_network migration. Run prisma migrate deploy." };
  }
  if (rows.length === 0) return { ok: true, people: [] };

  const found = await prisma.profile.findMany({ where: { id: { in: rows.map((r) => r.profile_id) }, onboardedAt: { not: null } }, include: cardInclude });
  const mine = new Set(viewer.tags.map(norm));
  const people = rows
    .map((r): PersonCard | null => {
      const p = found.find((f) => f.id === r.profile_id);
      if (!p) return null;
      const card = toCard(p, mine, Number(r.similarity));
      return { ...card, why: card.why ?? `Close match for “${q.length > 40 ? `${q.slice(0, 37)}…` : q}”.` };
    })
    .filter((c): c is PersonCard => c !== null);
  return { ok: true, people };
}

/* --------------------------- 2. reverse mentor finder --------------------------- */

/**
 * People (usually juniors) who can teach you what you're curious about but
 * don't list as your own skill. Ranked by how many of those gaps they cover,
 * then by being younger than you, which is what makes it "reverse".
 */
export async function reverseMentors(viewer: Viewer, scope: Scope): Promise<PersonCard[]> {
  const self = await me(viewer.id);
  const skills = new Set(self.expertise.map(norm));
  const wants = new Set([...self.interests.map(norm)].filter((t) => !skills.has(t)));
  if (wants.size === 0) return [];

  const rows = await prisma.profile.findMany({
    where: { ...scopeWhere(viewer, scope), expertise: { isEmpty: false } },
    include: cardInclude,
    take: 400,
  });
  const mine = new Set(viewer.tags.map(norm));

  return rows
    .map((p) => {
      const teaches = [...new Set(p.expertise.filter((t) => wants.has(norm(t))))];
      const younger =
        p.role === "student" && self.role === "alumni" ? 2 : p.batchYear && self.batchYear && p.batchYear > self.batchYear ? 1 : 0;
      return { p, teaches, score: teaches.length * 3 + younger };
    })
    .filter((x) => x.teaches.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map(({ p, teaches }) => ({
      ...toCard(p, mine, null),
      why: `Can teach you ${list(teaches.slice(0, 3))}${p.role === "student" ? ", from a student’s view" : ""}.`,
    }));
}

/* ----------------------------- 3. co-founder finder ----------------------------- */

/**
 * Co-founder suggestions: people looking for a co-founder whose skills fill
 * your gaps (skills you don't list) while sharing what you care about.
 * Embedding similarity, when present, breaks ties.
 */
export async function cofounders(viewer: Viewer, scope: Scope): Promise<PersonCard[]> {
  const self = await me(viewer.id);
  const skills = new Set(self.expertise.map(norm));
  const cares = new Set([...self.interests, ...self.expertise].map(norm));

  const [rows, sims] = await Promise.all([
    prisma.profile.findMany({ where: { ...scopeWhere(viewer, scope), intents: { has: "cofounder" } }, include: cardInclude, take: 400 }),
    similarities(viewer.id, scope),
  ]);
  const mine = new Set(viewer.tags.map(norm));

  return rows
    .map((p) => {
      const brings = [...new Set(p.expertise.filter((t) => !skills.has(norm(t))))];
      const shared = [...new Set(p.interests.filter((t) => cares.has(norm(t))))];
      const sim = sims.get(p.id) ?? null;
      return { p, brings, shared, sim, score: Math.min(brings.length, 5) * 2 + shared.length * 3 + (sim ?? 0) * 4 };
    })
    .filter((x) => x.brings.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map(({ p, brings, shared, sim }) => ({
      ...toCard(p, mine, sim),
      why: `Brings ${list(brings.slice(0, 3))}${shared.length ? `. Also into ${list(shared.slice(0, 2))}` : ""}.`,
    }));
}
