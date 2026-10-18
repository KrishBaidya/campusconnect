"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createPostAs, type PostInput } from "@/lib/posting";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

export async function createPost(input: z.input<typeof PostInput>): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  const res = await createPostAs(user.id, input);
  if (!res.ok) return res;
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
