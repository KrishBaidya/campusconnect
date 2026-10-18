import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fullName } from "@/lib/people";
import { hueOf } from "@/lib/hue";

// Read model for /mentorship. Writes live in app/mentorship/actions.ts.

export type MiniPerson = {
  id: string;
  name: string;
  initials: string;
  hue: number;
  avatarUrl: string | null;
  /** "Product Lead, Razorpay" or the headline */
  title: string | null;
  /** "Alumni, 2016" */
  meta: string | null;
};

export type MentorshipItem = {
  id: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  other: MiniPerson;
  message: string;
  /** ISO strings; past ones are dropped for pending requests */
  slots: string[];
  scheduledAt: string | null;
  declineReason: string | null;
  createdAt: string;
  respondedAt: string | null;
};

export type MentorshipData = {
  incoming: MentorshipItem[];
  mentees: MentorshipItem[];
  mentors: MentorshipItem[];
  sent: MentorshipItem[];
  capacity: number;
  bookedThisMonth: number;
  openBlocks: string[];
};

const person = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    headline: true,
    role: true,
    batchYear: true,
    experiences: { orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }], take: 1 },
  },
} satisfies Prisma.ProfileDefaultArgs;

type PersonRow = Prisma.ProfileGetPayload<typeof person>;

function mini(p: PersonRow): MiniPerson {
  const name = fullName(p);
  const job = p.experiences[0];
  const role = p.role === "alumni" ? "Alumni" : p.role === "student" ? "Student" : null;
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
    title: (job ? [job.jobRole, job.company].filter(Boolean).join(", ") : p.headline) || null,
    meta: [role, p.batchYear].filter(Boolean).join(", ") || null,
  };
}

/** [start, end) of the UTC calendar month containing `d`. */
export function monthRange(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

const SENT_HISTORY_DAYS = 60;

export async function getMentorship(userId: string): Promise<MentorshipData> {
  const now = new Date();
  const { start, end } = monthRange(now);
  const since = new Date(now.getTime() - SENT_HISTORY_DAYS * 86_400_000);

  const [me, asMentor, asMentee, booked] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, select: { mentorCapacity: true, openBlocks: true } }),
    prisma.mentorshipRequest.findMany({
      where: { mentorId: userId, status: { in: ["pending", "accepted"] } },
      include: { mentee: person },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.mentorshipRequest.findMany({
      where: { menteeId: userId, OR: [{ status: { in: ["pending", "accepted"] } }, { createdAt: { gte: since } }] },
      include: { mentor: person },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.mentorshipRequest.count({
      where: { mentorId: userId, status: "accepted", scheduledAt: { gte: start, lt: end } },
    }),
  ]);

  const item = (r: (typeof asMentor)[number] | (typeof asMentee)[number], other: PersonRow): MentorshipItem => ({
    id: r.id,
    status: r.status,
    other: mini(other),
    message: r.message,
    slots: r.proposedSlots
      .filter((s) => r.status !== "pending" || s > now)
      .sort((a, b) => a.getTime() - b.getTime())
      .map((s) => s.toISOString()),
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    declineReason: r.declineReason,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
  });

  const bySession = (a: MentorshipItem, b: MentorshipItem) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "");

  return {
    incoming: asMentor.filter((r) => r.status === "pending").map((r) => item(r, r.mentee)),
    mentees: asMentor.filter((r) => r.status === "accepted").map((r) => item(r, r.mentee)).sort(bySession),
    mentors: asMentee.filter((r) => r.status === "accepted").map((r) => item(r, r.mentor)).sort(bySession),
    sent: asMentee.filter((r) => r.status !== "accepted").map((r) => item(r, r.mentor)),
    capacity: me?.mentorCapacity ?? 4,
    bookedThisMonth: booked,
    openBlocks: me?.openBlocks ?? [],
  };
}

/** What the request form on someone's profile needs to know. */
export async function getRequestContext(mentorId: string, menteeId: string) {
  const [mentor, open] = await Promise.all([
    prisma.profile.findUnique({ where: { id: mentorId }, select: { openBlocks: true, mentorCapacity: true, intents: true } }),
    prisma.mentorshipRequest.findFirst({
      where: { menteeId, mentorId, OR: [{ status: "pending" }, { status: "accepted", scheduledAt: { gte: new Date() } }] },
      orderBy: { createdAt: "desc" },
      select: { status: true, scheduledAt: true },
    }),
  ]);
  if (!mentor) return null;
  return {
    openToMentoring: mentor.intents.includes("mentor") && mentor.mentorCapacity > 0,
    openBlocks: mentor.openBlocks,
    existing: open ? { status: open.status, scheduledAt: open.scheduledAt?.toISOString() ?? null } : null,
  };
}
