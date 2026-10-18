"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { award } from "@/lib/points";
import { POST_POINTS_PER_DAY } from "@/lib/points-shared";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

const STORY_HOURS = 24;

const PostInput = z
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

export async function createPost(input: z.input<typeof PostInput>): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  const parsed = PostInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid post");
  const { kind, body, linkUrl, company } = parsed.data;

  const me = await prisma.profile.findUnique({ where: { id: user.id }, select: { collegeId: true, onboardedAt: true } });
  if (!me?.onboardedAt) return fail("Finish your profile before posting.");

  const since = new Date(Date.now() - 86_400_000);
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        authorId: user.id,
        collegeId: me.collegeId,
        kind,
        body,
        linkUrl: linkUrl ?? null,
        company: company ?? null,
        expiresAt: kind === "story" ? new Date(Date.now() + STORY_HOURS * 3_600_000) : null,
      },
    });
    const paidToday = await tx.pointEvent.count({ where: { profileId: user.id, reason: "post", createdAt: { gte: since } } });
    if (paidToday < POST_POINTS_PER_DAY) await award(tx, user.id, "post", post.id);
  });
  revalidatePath("/");
  return { ok: true };
}

export async function toggleLike(postId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(postId).success) return fail("Invalid post");

  const { count } = await prisma.postLike.deleteMany({ where: { postId, profileId: user.id } });
  if (count === 0) {
    const exists = await prisma.post.count({ where: { id: postId } });
    if (!exists) return fail("That post was deleted.");
    await prisma.postLike.createMany({ data: [{ postId, profileId: user.id }], skipDuplicates: true });
  }
  revalidatePath("/");
  return { ok: true };
}

export async function deletePost(postId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(postId).success) return fail("Invalid post");
  const { count } = await prisma.post.deleteMany({ where: { id: postId, authorId: user.id } });
  if (count === 0) return fail("Post not found.");
  revalidatePath("/");
  return { ok: true };
}
