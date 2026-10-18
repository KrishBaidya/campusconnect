"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarCheck, CalendarClock, Check, CheckCheck, Inbox, Loader2, Search, Send, SquarePen, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { hueOf } from "@/lib/hue";
import {
  type ConversationSummary,
  type Message,
  type MiniProfile,
  type ThreadContext,
  displayName,
  fetchConversations,
  fetchMessages,
  fetchThreadContext,
  initials,
  markRead,
  searchProfiles,
  sendMessage,
  startConversation,
} from "@/lib/messages";
import { PersonNode } from "@/components/aluminx/person-node";
import { When, relative, useHydrated, useNow } from "@/components/aluminx/when";

type Props = {
  me: string;
  /** Open this conversation on load (?c=<id>). */
  initialConversationId?: string;
  /** Start/open a chat with this profile on load (?to=<profileId>). */
  initialRecipientId?: string;
};

const node = (p: MiniProfile) => ({ name: displayName(p), initials: initials(p), hue: hueOf(p.id), avatarUrl: p.avatar_url });

export function MessagesApp({ me, initialConversationId, initialRecipientId }: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const active = conversations?.find((c) => c.id === activeId) ?? null;

  const reloadConversations = useCallback(async () => {
    try {
      setConversations(await fetchConversations(supabase, me));
    } catch (e) {
      setError(errorText(e));
    }
  }, [supabase, me]);

  // Initial load (+ optional ?to= deep link)
  useEffect(() => {
    (async () => {
      if (initialRecipientId && initialRecipientId !== me) {
        try {
          setActiveId(await startConversation(supabase, initialRecipientId));
        } catch (e) {
          setError(errorText(e));
        }
      }
      await reloadConversations();
    })();
  }, [supabase, me, initialRecipientId, reloadConversations]);

  // Load the open thread and mark it read
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    fetchMessages(supabase, activeId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setLoadedId(activeId);
        setConversations((cs) => cs?.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)) ?? cs);
        return markRead(supabase, activeId, me);
      })
      .catch((e) => !cancelled && setError(errorText(e)));

    const url = new URL(window.location.href);
    url.searchParams.set("c", activeId);
    url.searchParams.delete("to");
    window.history.replaceState(null, "", url);

    return () => {
      cancelled = true;
    };
  }, [supabase, activeId, me]);

  // Realtime: RLS limits these events to the user's own conversations
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${me}`)
      .on<Message>("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new;
        const isOpen = msg.conversation_id === activeIdRef.current;

        if (isOpen) {
          setMessages((ms) => (ms.some((m) => m.id === msg.id) ? ms : [...ms, msg]));
          if (msg.sender_id !== me) markRead(supabase, msg.conversation_id, me).catch(() => {});
        }

        setConversations((cs) => {
          if (!cs) return cs;
          const existing = cs.find((c) => c.id === msg.conversation_id);
          if (!existing) {
            // Someone started a new chat with us — fetch it with its profile.
            void reloadConversations();
            return cs;
          }
          const updated: ConversationSummary = {
            ...existing,
            lastMessage: msg,
            last_message_at: msg.created_at,
            unread: !isOpen && msg.sender_id !== me ? existing.unread + 1 : existing.unread,
          };
          return [updated, ...cs.filter((c) => c.id !== msg.conversation_id)];
        });
      })
      .on<Message>("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new;
        setMessages((ms) => ms.map((m) => (m.id === msg.id ? { ...m, read_at: msg.read_at } : m)));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, me, reloadConversations]);

  const openConversation = (id: string) => {
    setComposing(false);
    setError(null);
    if (id !== activeId) setMessages([]);
    setActiveId(id);
  };

  const startWith = async (profile: MiniProfile) => {
    try {
      const id = await startConversation(supabase, profile.id);
      await reloadConversations();
      openConversation(id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const handleSend = async (body: string) => {
    if (!activeId) return;
    const msg = await sendMessage(supabase, activeId, me, body);
    setMessages((ms) => (ms.some((m) => m.id === msg.id) ? ms : [...ms, msg]));
    setConversations((cs) => {
      if (!cs) return cs;
      const c = cs.find((x) => x.id === activeId);
      if (!c) return cs;
      return [{ ...c, lastMessage: msg, last_message_at: msg.created_at }, ...cs.filter((x) => x.id !== activeId)];
    });
  };

  const search = useCallback((q: string) => searchProfiles(supabase, me, q), [supabase, me]);

  const q = filter.trim().toLowerCase();
  const shown = conversations?.filter(
    (c) => !q || displayName(c.other).toLowerCase().includes(q) || c.lastMessage?.body.toLowerCase().includes(q),
  );
  const open = composing || !!activeId;

  return (
    <div className={open ? "msgs open" : "msgs"}>
      {/* Conversation list */}
      <div className="convs">
        <div className="convs-h">
          <div className="row">
            <h1>Messages</h1>
            <button type="button" className="btn sm icon ghost" aria-label="New message" title="New message" onClick={() => setComposing(true)}>
              <SquarePen className="ic" />
            </button>
          </div>
          <label className="cmd">
            <Search className="ic" />
            <span className="sr">Search messages</span>
            <input className="input" placeholder="Search messages…" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>

        <div className="conv-list">
          {shown === undefined ? (
            <ListSkeleton />
          ) : conversations!.length === 0 ? (
            <div className="empty" style={{ padding: "40px 12px" }}>
              <Inbox className="ic" />
              <b>No conversations yet</b>
              <button type="button" className="btn primary sm" onClick={() => setComposing(true)}>
                Start a conversation
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="dim" style={{ padding: "24px 12px", fontSize: 13.5 }}>
              No conversations match “{filter.trim()}”.
            </p>
          ) : (
            shown.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className={["conv", c.id === activeId && !composing ? "on" : "", c.unread ? "unread" : ""].join(" ")}
                aria-current={c.id === activeId && !composing ? "true" : undefined}
              >
                <PersonNode person={node(c.other)} size="sm" />
                <div>
                  <b>
                    <span>{displayName(c.other)}</span>
                    {c.lastMessage && <When iso={c.lastMessage.created_at} format={formatShort} fallback="" />}
                  </b>
                  <small>{c.lastMessage ? `${c.lastMessage.sender_id === me ? "You: " : ""}${c.lastMessage.body}` : "No messages yet"}</small>
                </div>
                {c.unread > 0 && (
                  <span className="ub num" aria-label={`${c.unread} unread`}>
                    {c.unread}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="thread-c">
        {error && (
          <div className="banner" role="alert">
            <span>{error}</span>
            <button type="button" className="btn sm icon ghost" aria-label="Dismiss" onClick={() => setError(null)}>
              <X className="ic" />
            </button>
          </div>
        )}

        {composing ? (
          <NewConversation onBack={() => setComposing(false)} onPick={startWith} search={search} />
        ) : activeId ? (
          <Thread
            me={me}
            other={active?.other ?? null}
            messages={messages}
            loading={loadedId !== activeId}
            onBack={() => setActiveId(null)}
            onSend={handleSend}
            onError={(e) => setError(errorText(e))}
          />
        ) : (
          <div className="center">
            <Inbox className="ic" />
            <p>Select a conversation, or start a new one.</p>
          </div>
        )}
      </div>

      {/* Context */}
      <aside className="ctx" aria-label="About this conversation">
        {!composing && active ? <Context key={active.other.id} supabase={supabase} me={me} other={active.other} /> : null}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thread                                                              */
/* ------------------------------------------------------------------ */

function Thread({
  me,
  other,
  messages,
  loading,
  onBack,
  onSend,
  onError,
}: {
  me: string;
  other: MiniProfile | null;
  messages: Message[];
  loading: boolean;
  onBack: () => void;
  onSend: (body: string) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const hydrated = useHydrated();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft("");
      inputRef.current?.focus();
    } catch (e) {
      onError(e);
    } finally {
      setSending(false);
    }
  };

  const lastOwn = [...messages].reverse().find((m) => m.sender_id === me);

  return (
    <>
      <div className="th-h">
        <button type="button" className="btn sm icon ghost back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft className="ic" />
        </button>
        {other ? (
          <>
            <PersonNode person={node(other)} size="sm" />
            <div>
              <Link href={`/profile/${other.id}`}>
                <b>{displayName(other)}</b>
              </Link>
              {other.headline && <small>{other.headline}</small>}
            </div>
          </>
        ) : (
          <span className="skel" style={{ width: 180, height: 16 }} />
        )}
      </div>

      <div className="bubbles">
        {loading && messages.length === 0 ? (
          <div className="center">
            <Loader2 className="ic spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="center">
            <p>Say hi to {other ? displayName(other).split(" ")[0] : "them"}.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.sender_id === me;
            const prev = messages[i - 1];
            const newDay = hydrated && (!prev || !sameDay(prev.created_at, m.created_at));
            const grouped = prev && !newDay && prev.sender_id === m.sender_id;
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {newDay && <div className="sys">{formatDay(m.created_at)}</div>}
                <div className={["b", mine ? "me" : "", grouped ? "grouped" : ""].join(" ")} title={hydrated ? new Date(m.created_at).toLocaleString() : undefined}>
                  {m.body}
                </div>
                {mine && m.id === lastOwn?.id && (
                  <div className={m.read_at ? "b-meta ok" : "b-meta"}>
                    {m.read_at ? <CheckCheck className="ic" /> : <Check className="ic" />}
                    {m.read_at ? "seen" : "sent"} {hydrated ? formatTime(m.created_at) : ""}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="compose"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr" htmlFor="msgin">
          Message
        </label>
        <textarea
          id="msgin"
          ref={inputRef}
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Write a message…"
        />
        <button type="submit" className="btn primary icon" aria-label="Send" disabled={!draft.trim() || sending}>
          {sending ? <Loader2 className="ic spin" /> : <Send className="ic" />}
        </button>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Context panel                                                       */
/* ------------------------------------------------------------------ */

function Context({ supabase, me, other }: { supabase: ReturnType<typeof createClient>; me: string; other: MiniProfile }) {
  const now = useNow();
  const [ctx, setCtx] = useState<ThreadContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchThreadContext(supabase, me, other.id)
      .then((c) => !cancelled && setCtx(c))
      .catch(() => !cancelled && setCtx({ role: null, batchYear: null, shared: [], sessions: [] }));
    return () => {
      cancelled = true;
    };
  }, [supabase, me, other.id]);

  const meta = ctx ? [ctx.role === "alumni" ? "Alumni" : ctx.role === "student" ? "Student" : null, ctx.batchYear].filter(Boolean).join(", ") : null;
  const latest = ctx?.sessions.at(-1);

  return (
    <>
      <div className="who">
        <Link href={`/profile/${other.id}`} aria-label={`Open ${displayName(other)}'s profile`}>
          <PersonNode person={node(other)} size="lg" />
        </Link>
        <Link href={`/profile/${other.id}`}>
          <b>{displayName(other)}</b>
        </Link>
        {(meta || other.headline) && (
          <span className="muted" style={{ fontSize: 13.5 }}>
            {[meta, latest ? (latest.youAre === "mentee" ? "Your mentor" : "Your mentee") : null].filter(Boolean).join(". ") || other.headline}
          </span>
        )}
      </div>

      <div className="sec">
        <h3>Shared</h3>
        {ctx === null ? (
          <span className="skel" style={{ width: "70%", height: 20 }} />
        ) : ctx.shared.length ? (
          <div className="tags">
            {ctx.shared.map((t) => (
              <span key={t} className="chip acc">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <p className="dim" style={{ fontSize: 13.5 }}>
            No interests in common yet.
          </p>
        )}
      </div>

      <div className="sec">
        <h3>Sessions</h3>
        {ctx === null ? (
          <span className="skel" style={{ width: "80%", height: 32 }} />
        ) : ctx.sessions.length ? (
          <div className="stack">
            {ctx.sessions.map((s) => {
              const upcoming = now > 0 && new Date(s.at).getTime() > now;
              return (
                <div key={s.id} className="person">
                  {upcoming ? <CalendarClock className="ic" style={{ color: "var(--accent-hi)" }} /> : <CalendarCheck className="ic" style={{ color: "var(--ok)" }} />}
                  <div>
                    <b>Mentorship session</b>
                    <small>
                      <When iso={s.at} />
                      {upcoming ? `, ${relative(s.at, now)}` : now ? ", done" : ""}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="dim" style={{ fontSize: 13.5 }}>
            None yet. <Link href="/mentorship">Mentorship</Link> lists requests and sessions.
          </p>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New conversation picker                                             */
/* ------------------------------------------------------------------ */

function NewConversation({
  onBack,
  onPick,
  search,
}: {
  onBack: () => void;
  onPick: (p: MiniProfile) => Promise<void>;
  search: (q: string) => Promise<MiniProfile[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MiniProfile[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      search(query)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  return (
    <>
      <div className="th-h">
        <button type="button" className="btn sm icon ghost" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="ic" />
        </button>
        <div>
          <b>New message</b>
        </div>
      </div>
      <div style={{ padding: "16px 24px 8px" }}>
        <label className="cmd" style={{ margin: 0 }}>
          <Search className="ic" />
          <span className="sr">Search people</span>
          <input autoFocus className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students and alumni…" />
        </label>
      </div>
      <div className="conv-list" style={{ padding: "0 16px 16px" }}>
        {results === null ? (
          <ListSkeleton />
        ) : results.length === 0 ? (
          <p className="dim" style={{ padding: 24, textAlign: "center" }}>
            No people found.
          </p>
        ) : (
          results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="conv"
              disabled={picking !== null}
              onClick={async () => {
                setPicking(p.id);
                try {
                  await onPick(p);
                } finally {
                  setPicking(null);
                }
              }}
            >
              <PersonNode person={node(p)} size="sm" />
              <div>
                <b>
                  <span>{displayName(p)}</span>
                </b>
                {p.headline && <small>{p.headline}</small>}
              </div>
              {picking === p.id && <Loader2 className="ic spin" />}
            </button>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function ListSkeleton() {
  return (
    <div style={{ display: "grid", gap: 4 }} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="conv" style={{ cursor: "default" }}>
          <span className="skel" style={{ width: 32, height: 32, borderRadius: 10 }} />
          <div style={{ display: "grid", gap: 8 }}>
            <span className="skel" style={{ width: "50%", height: 11 }} />
            <span className="skel" style={{ width: "75%", height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function errorText(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong.";
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "today";
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function formatShort(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
