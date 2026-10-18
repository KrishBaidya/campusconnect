"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { draftNote, removeConnection, respondConnection, sendConnection, type SendInput } from "@/lib/connect";

// Thin, session-authenticated wrappers around lib/connect (which the MCP endpoint also uses).

export type ActionResult = { ok: true } | { ok: false; error: string };
const signedOut = { ok: false, error: "You’re signed out. Sign in and try again." } as const;

function refresh(otherId?: string) {
  revalidatePath("/");
  revalidatePath("/discover");
  if (otherId) revalidatePath(`/profile/${otherId}`);
}

export async function draftConnectMessage(targetId: string, context?: string) {
  const user = await getUser();
  if (!user) return signedOut;
  return draftNote(user.id, targetId, context);
}

export async function sendConnect(input: z.input<typeof SendInput>): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return signedOut;
  const res = await sendConnection(user.id, input);
  if (!res.ok) return res;
  refresh(input.targetId);
  return { ok: true };
}

export async function respondConnect(connectionId: string, accept: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return signedOut;
  const res = await respondConnection(user.id, connectionId, accept);
  if (!res.ok) return res;
  refresh(res.requesterId);
  return { ok: true };
}

/** Withdraw your pending request, or remove an existing connection. */
export async function removeConnect(connectionId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return signedOut;
  const res = await removeConnection(user.id, connectionId);
  if (!res.ok) return res;
  refresh(res.otherId);
  return { ok: true };
}
