import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Personal access tokens for /api/mcp. Format: "alx_" + 32 random bytes (base64url).
// Only the SHA-256 hash is stored, so a database leak doesn't leak working tokens.

const PREFIX = "alx_";
export const MAX_TOKENS = 5;
const TOUCH_EVERY_MS = 5 * 60_000; // don't write last_used_at on every request

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createApiToken(profileId: string, name: string) {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const row = await prisma.apiToken.create({
    data: { profileId, name: name.trim().slice(0, 60) || "MCP client", tokenHash: hash(token), prefix: token.slice(0, PREFIX.length + 6) },
  });
  return { id: row.id, token };
}

export async function listApiTokens(profileId: string) {
  return prisma.apiToken.findMany({
    where: { profileId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
  });
}

export async function revokeApiToken(profileId: string, id: string) {
  const { count } = await prisma.apiToken.updateMany({ where: { id, profileId, revokedAt: null }, data: { revokedAt: new Date() } });
  return count > 0;
}

/** The profile a bearer token belongs to, or null if it's unknown or revoked. */
export async function verifyApiToken(token: string): Promise<{ profileId: string; tokenId: string } | null> {
  if (!token.startsWith(PREFIX) || token.length < 40 || token.length > 100) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hash(token) }, select: { id: true, profileId: true, revokedAt: true, lastUsedAt: true } });
  if (!row || row.revokedAt) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { profileId: row.profileId, tokenId: row.id };
}
