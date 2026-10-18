import type { User } from "@supabase/supabase-js";

/** GitHub username from a linked Supabase identity (verified by OAuth), or null. */
export function githubUsernameOf(user: User): string | null {
  const id = user.identities?.find((i) => i.provider === "github");
  const d = (id?.identity_data ?? {}) as Record<string, unknown>;
  const name = (d.user_name ?? d.preferred_username) as string | undefined;
  return name && /^[a-zA-Z0-9-]{1,39}$/.test(name) ? name : null;
}
