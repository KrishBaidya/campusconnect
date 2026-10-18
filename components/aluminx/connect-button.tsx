"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, RefreshCw, Sparkles, UserPlus, X } from "lucide-react";
import type { ConnState } from "@/lib/network";
import { draftConnectMessage, removeConnect, respondConnect, sendConnect } from "@/app/network/actions";
import { relative, useNow } from "./when";
import { cn } from "@/lib/utils";

type Props = {
  person: { id: string; name: string };
  state: ConnState;
  size?: "sm" | "icon";
  primary?: boolean;
  /** where you found them, passed to the AI note ("their post about…", "Discover search for…") */
  context?: string;
};

/**
 * The mockup's link button: offline (Connect) -> handshake (awaiting, hover to
 * withdraw) -> live (connected, hover to message). Incoming requests show Accept.
 */
export function ConnectButton({ person, state, size, primary, context }: Props) {
  const router = useRouter();
  const now = useNow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const first = person.name.split(" ")[0];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn().catch(() => ({ ok: false, error: "Something went wrong." }));
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });

  const cls = cn("lk", size, primary && "primary");
  const since = (iso: string) => (now ? relative(iso, now).replace(" ago", "") : "");

  let button: React.ReactNode;
  if (state.status === "none") {
    button = (
      <ConnectDialog person={person} context={context} onSent={() => router.refresh()} className={cls} iconOnly={size === "icon"} />
    );
  } else if (state.status === "outgoing") {
    button = (
      <button
        type="button"
        className={cls}
        data-s="handshake"
        disabled={pending}
        onClick={() => run(() => removeConnect(state.id))}
        aria-label={`Request to ${person.name} pending. Activate to withdraw`}
        title={size === "icon" ? "Withdraw request" : undefined}
      >
        <span className="lk-rail">
          <i />
        </span>
        <span className="lk-a">awaiting {since(state.since)}</span>
        <span className="lk-b">Withdraw</span>
      </button>
    );
  } else if (state.status === "incoming") {
    button = (
      <span className="lk-pair">
        <button
          type="button"
          className={cn("lk primary", size)}
          data-s="offline"
          disabled={pending}
          onClick={() => run(() => respondConnect(state.id, true))}
          title={state.message ?? `${first} wants to connect`}
          aria-label={`Accept ${person.name}'s request`}
        >
          <Check className="ic" />
          <span className="lk-a">Accept</span>
        </button>
        <button
          type="button"
          className="btn sm icon ghost"
          disabled={pending}
          onClick={() => run(() => respondConnect(state.id, false))}
          aria-label={`Decline ${person.name}'s request`}
          title="Decline"
        >
          <X className="ic" />
        </button>
      </span>
    );
  } else {
    button = (
      <button
        type="button"
        className={cls}
        data-s="live"
        disabled={pending}
        onClick={() => router.push(`/messages?to=${person.id}`)}
        aria-label={`Connected with ${person.name}. Activate to message`}
        title={size === "icon" ? "Message" : undefined}
      >
        <span className="lk-dot" />
        <span className="lk-a">live {since(state.since)}</span>
        <span className="lk-b">Message</span>
      </button>
    );
  }

  return (
    <>
      {button}
      {error && (
        <span className="err-t" role="alert">
          <CircleAlert className="ic" />
          {error}
        </span>
      )}
    </>
  );
}

/** The offline "Connect" button plus its dialog; opening it drafts a note with Gemini. */
function ConnectDialog({
  person,
  context,
  onSent,
  className,
  iconOnly,
}: {
  person: { id: string; name: string };
  context?: string;
  onSent: () => void;
  className: string;
  iconOnly: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [ai, setAi] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = person.name.split(" ")[0];

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const res = await draftConnectMessage(person.id, context);
      if (res.ok) {
        setNote(res.note);
        setAi(res.ai);
      } else setError(res.error);
    } catch {
      setError("Couldn’t draft a note. Write your own below.");
    } finally {
      setDrafting(false);
    }
  };

  const open = () => {
    ref.current?.showModal();
    if (!note && !drafting) void draft();
  };

  return (
    <>
      <button
        type="button"
        className={className}
        data-s="offline"
        onClick={open}
        aria-label={`Connect with ${person.name}`}
        title={iconOnly ? `Connect with ${person.name}` : undefined}
      >
        <UserPlus className="ic" />
        <span className="lk-a">Connect</span>
      </button>
      <dialog ref={ref} className="dlg" aria-labelledby={`cn-${person.id}`} onClose={() => setError(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const dlg = e.currentTarget.closest("dialog");
            start(async () => {
              const res = await sendConnect({ targetId: person.id, message: note.trim() || undefined }).catch(() => ({
                ok: false as const,
                error: "Something went wrong.",
              }));
              if (!res.ok) return setError(res.error);
              dlg?.close();
              setNote("");
              onSent();
            });
          }}
        >
          <div>
            <h2 id={`cn-${person.id}`}>Connect with {first}</h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
              Your note goes to {first}&apos;s Messages with the request. Both of you earn points when they accept.
            </p>
          </div>
          <label className="sec" style={{ gap: 8 }}>
            <span className="lbl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Personal note
              {ai && !drafting && (
                <span className="chip acc xs">
                  <Sparkles className="ic" style={{ fontSize: 11 }} />
                  drafted by Gemini
                </span>
              )}
            </span>
            <textarea
              className="input"
              value={drafting ? "" : note}
              placeholder={drafting ? "Drafting a note from your profiles…" : `Hi ${first}, …`}
              onChange={(e) => setNote(e.target.value)}
              maxLength={600}
              disabled={drafting}
            />
          </label>
          <div className="dlg-f">
            {error && (
              <span className="err-t" role="alert">
                <CircleAlert className="ic" />
                {error}
              </span>
            )}
            <button type="button" className="btn ghost sm" onClick={draft} disabled={drafting || pending} style={{ marginRight: "auto" }}>
              <RefreshCw className={drafting ? "ic spin" : "ic"} />
              Redraft
            </button>
            <button type="button" className="btn ghost" onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending || drafting}>
              {pending ? "Sending…" : "Send request"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
