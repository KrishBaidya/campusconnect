"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { monthRange } from "@/lib/mentorship";
import { DECLINE_REASONS } from "@/lib/mentorship-shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_DAYS_AHEAD = 60;
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

const RequestInput = z.object({
  mentorId: z.uuid(),
  message: z.string().trim().min(10, "Say a little more about what you want help with (10+ characters).").max(1000),
  slots: z.array(z.iso.datetime({ offset: true })).min(1, "Pick at least one time.").max(3, "Pick up to three times."),
});

export async function requestMentorship(input: z.input<typeof RequestInput>): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return fail("You’re signed out. Sign in and try again.");
  const parsed = RequestInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request");
  const { mentorId, message, slots } = parsed.data;
  if (mentorId === userId) return fail("You can’t request yourself.");

  const now = Date.now();
  const times = [...new Set(slots.map((s) => new Date(s).getTime()))].sort((a, b) => a - b);
  if (times.some((t) => t <= now)) return fail("All times need to be in the future.");
  if (times.some((t) => t > now + MAX_DAYS_AHEAD * 86_400_000)) return fail(`Pick times within the next ${MAX_DAYS_AHEAD} days.`);

  const mentor = await prisma.profile.findUnique({ where: { id: mentorId }, select: { intents: true, mentorCapacity: true, onboardedAt: true } });
  if (!mentor?.onboardedAt) return fail("That person isn’t on AluminX yet.");
  if (!mentor.intents.includes("mentor") || mentor.mentorCapacity === 0) return fail("They aren’t taking mentorship requests right now.");

  try {
    await prisma.mentorshipRequest.create({
      data: { menteeId: userId, mentorId, message, proposedSlots: times.map((t) => new Date(t)) },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("You already have an open request with them.");
    throw e;
  }
  refresh(mentorId);
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
