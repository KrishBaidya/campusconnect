"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { MAX_TOKENS, createApiToken, revokeApiToken } from "@/lib/api-tokens";

const fail = (error: string) => ({ ok: false, error }) as const;

/** Creates a token for the signed-in user. The token is returned once and never stored in plain text. */
export async function createToken(name: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  const parsed = z.string().trim().min(1, "Name the token, e.g. Claude Desktop.").max(60).safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid name");

  const active = await prisma.apiToken.count({ where: { profileId: user.id, revokedAt: null } });
  if (active >= MAX_TOKENS) return fail(`You can have ${MAX_TOKENS} active tokens. Revoke one first.`);

  const { token } = await createApiToken(user.id, parsed.data);
  revalidatePath("/profile");
  return { ok: true, token };
}

export async function revokeToken(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return fail("You’re signed out. Sign in and try again.");
  if (!z.uuid().safeParse(id).success || !(await revokeApiToken(user.id, id))) return fail("Token not found.");
  revalidatePath("/profile");
  return { ok: true };
}
