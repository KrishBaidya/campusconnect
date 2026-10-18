import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fullName, type Viewer } from "@/lib/people";
import { hueOf } from "@/lib/hue";
import { connectedIds, connectionStates, type ConnState } from "@/lib/network";

export type FeedScope = "foryou" | "college" | "global";

export type FeedAuthor = {
  id: string;
  name: string;
  initials: string;
  hue: number;
  avatarUrl: string | null;
  /** "Product Lead, Razorpay. Alumni 2016" */
  line: string | null;
  openToMentoring: boolean;
};

export type FeedPost = {
  id: string;
  kind: "update" | "opportunity" | "referral" | "project" | "story";
  body: string;
  linkUrl: string | null;
  company: string | null;
  createdAt: string;
  expiresAt: string | null;
  author: FeedAuthor;
  likes: number;
  liked: boolean;
  mine: boolean;
};

export type Feed = {
  posts: FeedPost[];
  stories: { author: FeedAuthor; posts: FeedPost[] }[];
  connections: Record<string, ConnState>;
};

const author = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    headline: true,
    role: true,
    batchYear: true,
    intents: true,
    experiences: { orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }], take: 1 },
  },
} satisfies Prisma.ProfileDefaultArgs;

type AuthorRow = Prisma.ProfileGetPayload<typeof author>;

export function feedAuthor(p: AuthorRow): FeedAuthor {
  const name = fullName(p);
  const job = p.experiences[0];
  const title = job ? [job.jobRole, job.company].filter(Boolean).join(", ") : p.headline;
  const who = [p.role === "alumni" ? "Alumni" : p.role === "student" ? "Student" : null, p.batchYear].filter(Boolean).join(" ");
  return {
    id: p.id,
    name,
    initials:
      name === "Unnamed member"
        ? "?"
        : name
            .split(/\s+/)
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
    hue: hueOf(p.id),
    avatarUrl: p.avatarUrl,
    line: [title, who].filter(Boolean).join(". ") || null,
    openToMentoring: p.intents.includes("mentor"),
  };
}

/** Closest people by embedding, for "For you". Empty when match_profiles isn't deployed or you have no embedding. */
async function nearestIds(userId: string, limit: number) {
  try {
    const rows = await prisma.$queryRaw<{ profile_id: string }[]>`select profile_id from public.match_profiles(${userId}::uuid, 'global', ${limit}::int)`;
    return rows.map((r) => r.profile_id);
  } catch {
    return [];
  }
}

const PAGE = 30;

export async function getFeed(viewer: Viewer, scope: FeedScope): Promise<Feed> {
  const now = new Date();
  let where: Prisma.PostWhereInput;
  if (scope === "global") where = {};
  else if (scope === "college") where = viewer.collegeId ? { collegeId: viewer.collegeId } : { authorId: viewer.id };
  else {
    // For you: your connections, your college, people closest to you, and yourself
    const [conn, near] = await Promise.all([connectedIds(viewer.id), nearestIds(viewer.id, 50)]);
    where = {
      OR: [{ authorId: { in: [viewer.id, ...conn, ...near] } }, ...(viewer.collegeId ? [{ collegeId: viewer.collegeId }] : [])],
    };
  }

  const include = {
    author,
    _count: { select: { likes: true } },
    likes: { where: { profileId: viewer.id }, select: { profileId: true } },
  } satisfies Prisma.PostInclude;

  const [posts, stories] = await Promise.all([
    prisma.post.findMany({ where: { ...where, kind: { not: "story" } }, include, orderBy: { createdAt: "desc" }, take: PAGE }),
    prisma.post.findMany({ where: { ...where, kind: "story", expiresAt: { gt: now } }, include, orderBy: { createdAt: "asc" }, take: 60 }),
  ]);

  const toPost = (p: (typeof posts)[number]): FeedPost => ({
    id: p.id,
    kind: p.kind,
    body: p.body,
    linkUrl: p.linkUrl,
    company: p.company,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt?.toISOString() ?? null,
    author: feedAuthor(p.author),
    likes: p._count.likes,
    liked: p.likes.length > 0,
    mine: p.authorId === viewer.id,
  });

  const grouped = new Map<string, { author: FeedAuthor; posts: FeedPost[] }>();
  for (const s of stories.map(toPost)) {
    const g = grouped.get(s.author.id) ?? { author: s.author, posts: [] };
    g.posts.push(s);
    grouped.set(s.author.id, g);
  }
  // your own stories first, then most recent
  const storyGroups = [...grouped.values()].sort(
    (a, b) => Number(b.author.id === viewer.id) - Number(a.author.id === viewer.id) || (b.posts.at(-1)?.createdAt ?? "").localeCompare(a.posts.at(-1)?.createdAt ?? ""),
  );

  const authorIds = [...posts.map((p) => p.authorId), ...stories.map((p) => p.authorId)];
  return { posts: posts.map(toPost), stories: storyGroups, connections: await connectionStates(viewer.id, authorIds) };
}

/** People you may know: closest by embedding, else recent members of your college; never people you're already linked with. */
export async function suggestions(viewer: Viewer, take = 4) {
  const linked = await prisma.connection.findMany({
    where: { status: { in: ["pending", "accepted"] }, OR: [{ requesterId: viewer.id }, { addresseeId: viewer.id }] },
    select: { requesterId: true, addresseeId: true },
  });
  const skip = new Set([viewer.id, ...linked.flatMap((l) => [l.requesterId, l.addresseeId])]);
  const near = (await nearestIds(viewer.id, 30)).filter((id) => !skip.has(id)).slice(0, take);

  let rows: AuthorRow[] = [];
  if (near.length) {
    const found = await prisma.profile.findMany({ where: { id: { in: near } }, ...author });
    rows = near.map((id) => found.find((f) => f.id === id)).filter((x): x is AuthorRow => Boolean(x));
  }
  if (rows.length < take) {
    rows.push(
      ...(await prisma.profile.findMany({
        where: {
          id: { notIn: [...skip, ...rows.map((r) => r.id)] },
          onboardedAt: { not: null },
          ...(viewer.collegeId ? { collegeId: viewer.collegeId } : {}),
        },
        orderBy: { onboardedAt: "desc" },
        take: take - rows.length,
        ...author,
      })),
    );
  }
  return rows.map(feedAuthor);
}
