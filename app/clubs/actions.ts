"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

const MAX_CLUBS = 8;
const Name = z
  .string()
  .trim()
  .min(2, "Club names need at least 2 characters.")
  .max(60, "Keep club names under 60 characters.")
  .transform((s) => s.replace(/\s+/g, " "));

function refresh() {
  revalidatePath("/profile");
  revalidatePath("/discover");
}

/** Join a club at your college by name, creating it if nobody has yet (case-insensitive match). */
export async function joinClub(name: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  const parsed = Name.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid club name");

  const me = await prisma.profile.findUnique({ where: { id: user.id }, select: { collegeId: true, _count: { select: { clubs: true } } } });
  if (!me?.collegeId) return fail("Add your college in profile setup before joining clubs.");
  if (me._count.clubs >= MAX_CLUBS) return fail(`You can list up to ${MAX_CLUBS} clubs.`);

  const club =
    (await prisma.club.findFirst({ where: { collegeId: me.collegeId, name: { equals: parsed.data, mode: "insensitive" } } })) ??
    (await prisma.club.upsert({
      where: { collegeId_name: { collegeId: me.collegeId, name: parsed.data } },
      update: {},
      create: { collegeId: me.collegeId, name: parsed.data },
    }));

  await prisma.clubMember.upsert({
    where: { clubId_profileId: { clubId: club.id, profileId: user.id } },
    update: {},
    create: { clubId: club.id, profileId: user.id },
  });
  refresh();
  return { ok: true };
}

export async function leaveClub(name: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  await prisma.clubMember.deleteMany({ where: { profileId: user.id, club: { name } } });
  refresh();
  return { ok: true };
}
