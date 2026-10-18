import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { draftConnectNote, type NoteProfile } from "@/lib/ai/gemini";
import { fullName } from "@/lib/people";
import { award } from "@/lib/points";

// The Connect handshake, acting as `userId`. Callers authenticate first: the
// server actions (Supabase session) and the MCP endpoint (API token) both use these.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

const noteInclude = {
  college: { select: { name: true } },
  experiences: { orderBy: [{ endDate: { sort: "desc" as const, nulls: "first" as const } }], take: 3 },
};

function noteProfile(p: Prisma.ProfileGetPayload<{ include: typeof noteInclude }>): NoteProfile {
  return {
    name: fullName(p),
    role: p.role,
    college: p.college?.name ?? null,
    headline: p.headline,
    interests: p.interests.slice(0, 10),
    expertise: p.expertise.slice(0, 10),
    intents: p.intents,
    experiences: p.experiences.map((e) => ({ company: e.company, jobRole: e.jobRole })),
  };
}

/** Fallback when Gemini isn't configured or fails: a plain note built from what you share. */
function templateNote(from: NoteProfile, to: NoteProfile) {
  const first = to.name.split(" ")[0];
  const mine = new Set([...from.interests, ...from.expertise].map((t) => t.toLowerCase()));
  const shared = [...to.interests, ...to.expertise].find((t) => mine.has(t.toLowerCase()));
  const job = to.experiences[0];
  if (shared) return `Hi ${first}, I saw we're both into ${shared}. I'd love to connect and hear how you got into it.`;
  if (job) return `Hi ${first}, I came across your work at ${job.company} and would love to connect and learn from your experience.`;
  return `Hi ${first}, I'd love to connect${from.college && from.college === to.college ? ` as a fellow ${from.college} member` : ""}.`;
}

export async function draftNote(userId: string, targetId: string, context?: string): Promise<Result<{ note: string; ai: boolean }>> {
  if (!z.uuid().safeParse(targetId).success || targetId === userId) return fail("Invalid person");

  const [me, them] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, include: noteInclude }),
    prisma.profile.findUnique({ where: { id: targetId }, include: noteInclude }),
  ]);
  if (!me || !them?.onboardedAt) return fail("Profile not found");
  const from = noteProfile(me);
  const to = noteProfile(them);

  try {
    return { ok: true, note: await draftConnectNote(from, to, context?.slice(0, 200)), ai: true };
  } catch (e) {
    console.warn("Connect note via Gemini failed, using a template:", e);
    return { ok: true, note: templateNote(from, to), ai: false };
  }
}

export const SendInput = z.object({ targetId: z.uuid(), message: z.string().trim().max(600).optional() });

/**
 * Sends a connection request. The note (if any) is also delivered as the first
 * message in your conversation, so it lands in their Messages inbox.
 * If they had already asked you, this accepts their request instead.
 */
export async function sendConnection(userId: string, input: z.input<typeof SendInput>): Promise<Result<{ accepted?: boolean }>> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return fail("Your note can be up to 600 characters.");
  const { targetId, message } = parsed.data;
  if (targetId === userId) return fail("You can’t connect with yourself.");

  const target = await prisma.profile.findUnique({ where: { id: targetId }, select: { onboardedAt: true } });
  if (!target?.onboardedAt) return fail("That person isn’t on AluminX yet.");

  const existing = await prisma.connection.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: targetId },
        { requesterId: targetId, addresseeId: userId },
      ],
    },
  });
  if (existing?.status === "accepted") return fail("You’re already connected.");
  if (existing?.status === "pending" && existing.requesterId === userId) return fail("Your request is already waiting on them.");
  if (existing?.status === "pending") {
    const res = await respondConnection(userId, existing.id, true);
    return res.ok ? { ok: true, accepted: true } : res;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        // a declined request can be re-sent: reuse the pair's row
        await tx.connection.update({
          where: { id: existing.id },
          data: { requesterId: userId, addresseeId: targetId, status: "pending", message: message || null, createdAt: new Date(), respondedAt: null },
        });
      } else {
        await tx.connection.create({ data: { requesterId: userId, addresseeId: targetId, message: message || null } });
      }
      if (message) {
        const [a, b] = [userId, targetId].sort();
        const convo = await tx.conversation.upsert({
          where: { userAId_userBId: { userAId: a, userBId: b } },
          update: {},
          create: { userAId: a, userBId: b },
        });
        await tx.message.create({ data: { conversationId: convo.id, senderId: userId, body: message } });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("You already have a request with them.");
    throw e;
  }
  return { ok: true };
}

export async function respondConnection(userId: string, connectionId: string, accept: boolean): Promise<Result<{ requesterId?: string }>> {
  if (!z.uuid().safeParse(connectionId).success) return fail("Invalid request");

  return prisma.$transaction(async (tx) => {
    const c = await tx.connection.findUnique({ where: { id: connectionId } });
    if (!c || c.addresseeId !== userId) return fail("Request not found.");
    const { count } = await tx.connection.updateMany({
      where: { id: connectionId, status: "pending" },
      data: { status: accept ? "accepted" : "declined", respondedAt: new Date() },
    });
    if (count === 0) return fail("This request was already answered.");
    if (accept) {
      await award(tx, c.requesterId, "connection", c.id);
      await award(tx, c.addresseeId, "connection", c.id);
    }
    return { ok: true, requesterId: c.requesterId } as const;
  });
}

/** Withdraw your pending request, or remove an existing connection. */
export async function removeConnection(userId: string, connectionId: string): Promise<Result<{ otherId?: string }>> {
  if (!z.uuid().safeParse(connectionId).success) return fail("Invalid request");

  const c = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!c || (c.requesterId !== userId && c.addresseeId !== userId)) return fail("Connection not found.");
  if (c.status === "pending" && c.requesterId !== userId) return fail("Decline the request instead.");
  await prisma.connection.delete({ where: { id: connectionId } });
  return { ok: true, otherId: c.requesterId === userId ? c.addresseeId : c.requesterId };
}
