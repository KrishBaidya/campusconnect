import "server-only";
import { prisma } from "@/lib/prisma";

/** Where you stand with someone: the Connect button's offline -> handshake -> live states. */
export type ConnState =
  | { status: "none" }
  | { status: "outgoing"; id: string; since: string }
  | { status: "incoming"; id: string; since: string; message: string | null }
  | { status: "connected"; id: string; since: string };

const NONE: ConnState = { status: "none" };

/** Connection state between `me` and each of `ids` (declined requests read as "none" so people can ask again later). */
export async function connectionStates(me: string, ids: string[]): Promise<Record<string, ConnState>> {
  const unique = [...new Set(ids.filter((id) => id !== me))];
  const out: Record<string, ConnState> = Object.fromEntries(unique.map((id) => [id, NONE]));
  if (unique.length === 0) return out;

  const rows = await prisma.connection.findMany({
    where: {
      status: { in: ["pending", "accepted"] },
      OR: [
        { requesterId: me, addresseeId: { in: unique } },
        { addresseeId: me, requesterId: { in: unique } },
      ],
    },
  });
  for (const c of rows) {
    const other = c.requesterId === me ? c.addresseeId : c.requesterId;
    out[other] =
      c.status === "accepted"
        ? { status: "connected", id: c.id, since: (c.respondedAt ?? c.createdAt).toISOString() }
        : c.requesterId === me
          ? { status: "outgoing", id: c.id, since: c.createdAt.toISOString() }
          : { status: "incoming", id: c.id, since: c.createdAt.toISOString(), message: c.message };
  }
  return out;
}

export async function connectionState(me: string, other: string) {
  return (await connectionStates(me, [other]))[other] ?? NONE;
}

/** Ids of everyone you're connected to. */
export async function connectedIds(me: string) {
  const rows = await prisma.connection.findMany({
    where: { status: "accepted", OR: [{ requesterId: me }, { addresseeId: me }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === me ? r.addresseeId : r.requesterId));
}

export async function connectionCount(profileId: string) {
  return prisma.connection.count({ where: { status: "accepted", OR: [{ requesterId: profileId }, { addresseeId: profileId }] } });
}

/** Handshakes waiting on you, newest first. */
export async function incomingRequests(me: string, take = 10) {
  return prisma.connection.findMany({
    where: { addresseeId: me, status: "pending" },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, headline: true } },
    },
  });
}
