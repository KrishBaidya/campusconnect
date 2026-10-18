import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Result } from "@/lib/connect";

const MAX_DAYS_AHEAD = 60;
const fail = (error: string) => ({ ok: false, error }) as const;

export const RequestInput = z.object({
  mentorId: z.uuid(),
  message: z.string().trim().min(10, "Say a little more about what you want help with (10+ characters).").max(1000),
  slots: z.array(z.iso.datetime({ offset: true })).min(1, "Pick at least one time.").max(3, "Pick up to three times."),
});

/** Sends a mentorship request as `userId`. Callers authenticate first (server action or MCP token). */
export async function requestMentorshipAs(userId: string, input: z.input<typeof RequestInput>): Promise<Result> {
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
  return { ok: true };
}
