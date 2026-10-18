import type { SupabaseClient } from "@supabase/supabase-js";

// Row shapes for the messages feature (see prisma/migrations/2_messages).

export type MiniProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  headline: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type ConversationSummary = {
  id: string;
  last_message_at: string;
  other: MiniProfile;
  lastMessage: Message | null;
  unread: number;
};

const PROFILE_FIELDS = "id, first_name, last_name, avatar_url, headline";

export function displayName(p: Pick<MiniProfile, "first_name" | "last_name"> | null | undefined) {
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  return name || "Unnamed user";
}

export function initials(p: Pick<MiniProfile, "first_name" | "last_name"> | null | undefined) {
  const name = displayName(p);
  return name === "Unnamed user"
    ? "?"
    : name
        .split(/\s+/)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

type ConversationRow = {
  id: string;
  last_message_at: string;
  user_a: string;
  user_b: string;
  a: MiniProfile | null;
  b: MiniProfile | null;
  messages: Message[];
};

/** All of the user's conversations, newest activity first, with last message + unread count. */
export async function fetchConversations(
  supabase: SupabaseClient,
  me: string
): Promise<ConversationSummary[]> {
  const [{ data, error }, { data: unreadRows, error: unreadError }] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        `id, last_message_at, user_a, user_b,
         a:profiles!conversations_user_a_fkey(${PROFILE_FIELDS}),
         b:profiles!conversations_user_b_fkey(${PROFILE_FIELDS}),
         messages(id, conversation_id, sender_id, body, created_at, read_at)`
      )
      .order("last_message_at", { ascending: false })
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" })
      .returns<ConversationRow[]>(),
    supabase
      .from("messages")
      .select("conversation_id")
      .is("read_at", null)
      .neq("sender_id", me),
  ]);

  if (error) throw error;
  if (unreadError) throw unreadError;

  const unread = new Map<string, number>();
  for (const r of unreadRows ?? []) {
    unread.set(r.conversation_id, (unread.get(r.conversation_id) ?? 0) + 1);
  }

  return (data ?? []).map((c) => {
    const other = (c.user_a === me ? c.b : c.a) ?? {
      id: c.user_a === me ? c.user_b : c.user_a,
      first_name: null,
      last_name: null,
      avatar_url: null,
      headline: null,
    };
    return {
      id: c.id,
      last_message_at: c.last_message_at,
      other,
      lastMessage: c.messages[0] ?? null,
      unread: unread.get(c.id) ?? 0,
    };
  });
}

export async function fetchMessages(supabase: SupabaseClient, conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at, read_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500)
    .returns<Message[]>();
  if (error) throw error;
  return data ?? [];
}

export async function searchProfiles(supabase: SupabaseClient, me: string, query: string) {
  const q = query.trim().replace(/[%_,()]/g, " ").trim();
  let req = supabase.from("profiles").select(PROFILE_FIELDS).neq("id", me).limit(20);
  if (q) req = req.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,headline.ilike.%${q}%`);
  const { data, error } = await req.returns<MiniProfile[]>();
  if (error) throw error;
  return data ?? [];
}

/** Returns the id of the (possibly new) conversation with `otherId`. */
export async function startConversation(supabase: SupabaseClient, otherId: string) {
  const { data, error } = await supabase.rpc("start_conversation", { p_other_id: otherId });
  if (error) throw error;
  return data as string;
}

export async function sendMessage(
  supabase: SupabaseClient,
  conversationId: string,
  me: string,
  body: string
) {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: me, body })
    .select("id, conversation_id, sender_id, body, created_at, read_at")
    .single<Message>();
  if (error) throw error;
  return data;
}

export async function markRead(supabase: SupabaseClient, conversationId: string, me: string) {
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", me)
    .is("read_at", null);
  if (error) throw error;
}

export type ThreadContext = {
  role: "student" | "alumni" | null;
  batchYear: number | null;
  /** interests/expertise you both list */
  shared: string[];
  /** accepted mentorship sessions between you two, oldest first */
  sessions: { id: string; at: string; youAre: "mentor" | "mentee" }[];
};

/** Side-panel data for an open thread. Sessions are empty until the 4_mentorship migration is applied. */
export async function fetchThreadContext(supabase: SupabaseClient, me: string, otherId: string): Promise<ThreadContext> {
  const [{ data: people, error }, sessions] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, role, batch_year, interests, expertise")
      .in("id", [me, otherId])
      .returns<{ id: string; role: "student" | "alumni" | null; batch_year: number | null; interests: string[]; expertise: string[] }[]>(),
    supabase
      .from("mentorship_requests")
      .select("id, mentor_id, scheduled_at")
      .eq("status", "accepted")
      .or(`and(mentor_id.eq.${me},mentee_id.eq.${otherId}),and(mentor_id.eq.${otherId},mentee_id.eq.${me})`)
      .order("scheduled_at", { ascending: true })
      .returns<{ id: string; mentor_id: string; scheduled_at: string }[]>(),
  ]);
  if (error) throw error;

  const mine = people?.find((p) => p.id === me);
  const theirs = people?.find((p) => p.id === otherId);
  const myTags = new Set([...(mine?.interests ?? []), ...(mine?.expertise ?? [])].map((t) => t.toLowerCase()));
  const shared = [...new Set([...(theirs?.interests ?? []), ...(theirs?.expertise ?? [])].filter((t) => myTags.has(t.toLowerCase())))];

  return {
    role: theirs?.role ?? null,
    batchYear: theirs?.batch_year ?? null,
    shared,
    sessions: (sessions.data ?? []).map((s) => ({ id: s.id, at: s.scheduled_at, youAre: s.mentor_id === me ? "mentor" : "mentee" })),
  };
}
