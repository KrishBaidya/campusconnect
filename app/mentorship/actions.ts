"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/mentorship";
import { DECLINE_REASONS } from "@/lib/mentorship-shared";
import { award } from "@/lib/points";
import { requestMentorshipAs, type RequestInput } from "@/lib/mentorship-request";

export type ActionResult = { ok: true } | { ok: false; error: string };

const BLOCK = /^[0-6]-[0-2]$/;

const fail = (error: string): ActionResult => ({ ok: false, error });

async function me() {
  const user = await getUser();
  return user?.id ?? null;
}

function refresh(profileId?: string) {
  revalidatePath("/mentorship");
  if (profileId) revalidatePath(`/profile/${profileId}`);
}

export async function requestMentorship(input: z.input<typeof RequestInput>): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  const res = await requestMentorshipAs(userId, input);
  if (!res.ok) return res;
  refresh(input.mentorId);
  return { ok: true };
}

export async function acceptRequest(requestId: string, slot: string): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(requestId).success || !z.iso.datetime({ offset: true }).safeParse(slot).success) return fail("Invalid request");
  const at = new Date(slot);
  if (at.getTime() <= Date.now()) return fail("That time has already passed. Ask them for a new one.");

  return prisma.$transaction(async (tx) => {
    const r = await tx.mentorshipRequest.findUnique({ where: { id: requestId } });
    if (!r || r.mentorId !== userId) return fail("Request not found.");
    if (r.status !== "pending") return fail("This request was already answered.");
    if (!r.proposedSlots.some((s) => s.getTime() === at.getTime())) return fail("Pick one of the times they suggested.");

    const [{ mentorCapacity }, booked] = await Promise.all([
      tx.profile.findUniqueOrThrow({ where: { id: userId }, select: { mentorCapacity: true } }),
      tx.mentorshipRequest.count({
        where: { mentorId: userId, status: "accepted", scheduledAt: { gte: monthRange(at).start, lt: monthRange(at).end } },
      }),
    ]);
    if (booked >= mentorCapacity) return fail("Your slots for that month are full. Raise your limit in Slot settings first.");

    // status guard in the where makes a double-accept from two tabs a no-op
    const { count } = await tx.mentorshipRequest.updateMany({
      where: { id: requestId, status: "pending" },
      data: { status: "accepted", scheduledAt: at, respondedAt: new Date() },
    });
    if (count === 0) return fail("This request was already answered.");
    await award(tx, r.mentorId, "mentorship_accepted", r.id);
    await award(tx, r.menteeId, "session_booked", r.id);
    refresh();
    return { ok: true } as const;
  });
}

export async function declineRequest(requestId: string, reason: string | null): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(requestId).success) return fail("Invalid request");
  const why = reason && (DECLINE_REASONS as readonly string[]).includes(reason) ? reason : null;

  const { count } = await prisma.mentorshipRequest.updateMany({
    where: { id: requestId, mentorId: userId, status: "pending" },
    data: { status: "declined", declineReason: why, respondedAt: new Date() },
  });
  if (count === 0) return fail("This request was already answered.");
  refresh();
  return { ok: true };
}

export async function withdrawRequest(requestId: string): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(requestId).success) return fail("Invalid request");

  const { count } = await prisma.mentorshipRequest.updateMany({
    where: { id: requestId, menteeId: userId, status: "pending" },
    data: { status: "withdrawn", respondedAt: new Date() },
  });
  if (count === 0) return fail("This request was already answered.");
  refresh();
  return { ok: true };
}

const Settings = z.object({
  capacity: z.number().int().min(0).max(12),
  blocks: z.array(z.string().regex(BLOCK)).max(21),
});

export async function saveSlotSettings(input: z.input<typeof Settings>): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  const parsed = Settings.safeParse(input);
  if (!parsed.success) return fail("Invalid settings");

  await prisma.profile.update({
    where: { id: userId },
    data: { mentorCapacity: parsed.data.capacity, openBlocks: [...new Set(parsed.data.blocks)].sort() },
  });
  refresh();
  return { ok: true };
}
