"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, LogOut, MessageSquarePlus, Search, Send, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  type ConversationSummary,
  type Message,
  type MiniProfile,
  displayName,
  fetchConversations,
  fetchMessages,
  initials,
  markRead,
  searchProfiles,
  sendMessage,
  startConversation,
} from "@/lib/messages";

type Props = {
  me: string;
  /** Open this conversation on load (?c=<id>). */
  initialConversationId?: string;
  /** Start/open a chat with this profile on load (?to=<profileId>). */
  initialRecipientId?: string;
};

export function MessagesApp({ me, initialConversationId, initialRecipientId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
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
      .on<Message>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
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
        }
      )
      .on<Message>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new;
          setMessages((ms) => ms.map((m) => (m.id === msg.id ? { ...m, read_at: msg.read_at } : m)));
        }
      )
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
      return [
        { ...c, lastMessage: msg, last_message_at: msg.created_at },
        ...cs.filter((x) => x.id !== activeId),
      ];
    });
  };

  const search = useCallback((q: string) => searchProfiles(supabase, me, q), [supabase, me]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/signin");
    router.refresh();
  };

  const showThreadOnMobile = !!activeId && !composing;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex w-full flex-col border-r md:w-80 md:shrink-0",
          (showThreadOnMobile || composing) && "hidden md:flex"
        )}
      >
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <h1 className="text-lg font-semibold tracking-tight">Messages</h1>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="New message"
              onClick={() => setComposing(true)}
            >
              <MessageSquarePlus />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Sign out" onClick={signOut}>
              <LogOut />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {conversations === null ? (
            <ListSkeleton />
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <p>No conversations yet.</p>
              <Button size="sm" onClick={() => setComposing(true)}>
                Start a conversation
              </Button>
            </div>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => openConversation(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      c.id === activeId && !composing && "bg-muted"
                    )}
                  >
                    <ProfileAvatar profile={c.other} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>
                          {displayName(c.other)}
                        </span>
                        {c.lastMessage && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatShort(c.lastMessage.created_at)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            c.unread ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {c.lastMessage
                            ? `${c.lastMessage.sender_id === me ? "You: " : ""}${c.lastMessage.body}`
                            : "No messages yet"}
                        </span>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold text-primary-foreground">
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Right pane */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          showThreadOnMobile || composing ? "flex" : "hidden md:flex"
        )}
      >
        {error && (
          <div className="flex items-center justify-between gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setError(null)}>
              <X />
            </Button>
          </div>
        )}

        {composing ? (
          <NewConversation
            onBack={() => setComposing(false)}
            onPick={startWith}
            search={search}
          />
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
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Select a conversation, or start a new one.
          </div>
        )}
      </section>
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
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <Button size="icon" variant="ghost" className="md:hidden" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        {other ? (
          <>
            <ProfileAvatar profile={other} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName(other)}</p>
              {other.headline && (
                <p className="truncate text-xs text-muted-foreground">{other.headline}</p>
              )}
            </div>
          </>
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && messages.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Say hi to {other ? displayName(other).split(" ")[0] : "them"} 👋
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {messages.map((m, i) => {
              const mine = m.sender_id === me;
              const prev = messages[i - 1];
              const newDay = !prev || !sameDay(prev.created_at, m.created_at);
              const grouped = prev && !newDay && prev.sender_id === m.sender_id;
              return (
                <li key={m.id} className="flex flex-col">
                  {newDay && (
                    <span className="my-3 self-center text-xs text-muted-foreground">
                      {formatDay(m.created_at)}
                    </span>
                  )}
                  <div
                    title={new Date(m.created_at).toLocaleString()}
                    className={cn(
                      "max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      mine
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted text-foreground",
                      !grouped && "mt-2"
                    )}
                  >
                    {m.body}
                  </div>
                  {mine && m.id === lastOwn?.id && (
                    <span className="mt-0.5 self-end text-[0.7rem] text-muted-foreground">
                      {m.read_at ? "Seen" : "Sent"} · {formatTime(m.created_at)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={inputRef}
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
          aria-label="Message"
          className="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <Button type="submit" size="icon-lg" aria-label="Send" disabled={!draft.trim() || sending}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
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
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <Button size="icon" variant="ghost" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <h2 className="text-sm font-semibold">New message</h2>
      </header>
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students and alumni…"
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {results === null ? (
          <ListSkeleton />
        ) : results.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No people found.</p>
        ) : (
          <ul>
            {results.map((p) => (
              <li key={p.id}>
                <button
                  disabled={picking !== null}
                  onClick={async () => {
                    setPicking(p.id);
                    try {
                      await onPick(p);
                    } finally {
                      setPicking(null);
                    }
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
                >
                  <ProfileAvatar profile={p} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayName(p)}</p>
                    {p.headline && (
                      <p className="truncate text-xs text-muted-foreground">{p.headline}</p>
                    )}
                  </div>
                  {picking === p.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function ProfileAvatar({ profile }: { profile: MiniProfile }) {
  return (
    <Avatar size="lg">
      {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName(profile)} />}
      <AvatarFallback>{initials(profile)}</AvatarFallback>
    </Avatar>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
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
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
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
