import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { award } from "@/lib/points";
import { POST_POINTS_PER_DAY } from "@/lib/points-shared";
import type { Result } from "@/lib/connect";

const fail = (error: string) => ({ ok: false, error }) as const;

const STORY_HOURS = 24;

export const PostInput = z
  .object({
    kind: z.enum(["update", "opportunity", "referral", "project", "story"]),
    body: z.string().trim().min(1, "Write something first.").max(2000, "Keep posts under 2000 characters."),
    linkUrl: z
      .string()
      .trim()
      .url("That link doesn’t look right.")
      .refine((u) => /^https?:\/\//i.test(u), "Links need to start with http(s)://")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    company: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((p) => p.kind !== "referral" || p.company, { message: "Add the company you can refer to.", path: ["company"] })
  .refine((p) => p.kind !== "story" || p.body.length <= 280, { message: "Stories are short: 280 characters max.", path: ["body"] });

/** Creates a post or story as `userId`. Callers authenticate first (server action or MCP token). */
export async function createPostAs(userId: string, input: z.input<typeof PostInput>): Promise<Result<{ id: string }>> {
  const parsed = PostInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid post");
  const { kind, body, linkUrl, company } = parsed.data;

  const me = await prisma.profile.findUnique({ where: { id: userId }, select: { collegeId: true, onboardedAt: true } });
  if (!me?.onboardedAt) return fail("Finish your profile before posting.");

  const since = new Date(Date.now() - 86_400_000);
  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        authorId: userId,
        collegeId: me.collegeId,
        kind,
        body,
        linkUrl: linkUrl ?? null,
        company: company ?? null,
        expiresAt: kind === "story" ? new Date(Date.now() + STORY_HOURS * 3_600_000) : null,
      },
    });
    const paidToday = await tx.pointEvent.count({ where: { profileId: userId, reason: "post", createdAt: { gte: since } } });
    if (paidToday < POST_POINTS_PER_DAY) await award(tx, userId, "post", created.id);
    return created;
  });
  return { ok: true, id: post.id };
}
