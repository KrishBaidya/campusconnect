import "server-only";
import { prisma } from "@/lib/prisma";
import type { PointReason, Prisma } from "@/lib/generated/prisma/client";
import { POINTS } from "@/lib/points-shared";

type Tx = Prisma.TransactionClient | typeof prisma;

/**
 * Award points for an event. Safe to call twice: (profile, reason, refId) is
 * unique, so a repeat is skipped. A trigger adds the points to profiles.points.
 */
export async function award(db: Tx, profileId: string, reason: PointReason, refId: string) {
  await db.pointEvent.createMany({
    data: [{ profileId, reason, refId, points: POINTS[reason].points }],
    skipDuplicates: true,
  });
}

export type LeaderboardRow = { id: string; name: string; initials: string; points: number; avatarUrl: string | null };

/** Top members by points, optionally within one college. */
export async function leaderboard(collegeId: string | null, take = 5) {
  return prisma.profile.findMany({
    where: { onboardedAt: { not: null }, points: { gt: 0 }, ...(collegeId ? { collegeId } : {}) },
    orderBy: [{ points: "desc" }, { onboardedAt: "asc" }],
    take,
    select: { id: true, firstName: true, lastName: true, avatarUrl: true, points: true },
  });
}

/** 1-based rank of a member among everyone with more points (ties share a rank). */
export async function rankOf(points: number, collegeId: string | null) {
  const ahead = await prisma.profile.count({
    where: { onboardedAt: { not: null }, points: { gt: points }, ...(collegeId ? { collegeId } : {}) },
  });
  return ahead + 1;
}

export async function recentPoints(profileId: string, take = 5) {
  return prisma.pointEvent.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, reason: true, points: true, createdAt: true },
  });
}
