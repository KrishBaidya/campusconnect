"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, Check, CircleAlert, Clock, Handshake, Plus, X } from "lucide-react";
import { requestMentorship } from "@/app/mentorship/actions";
import { upcomingFromBlocks } from "@/lib/mentorship-shared";
import { When, formatSlot, useHydrated } from "./when";

export type RequestContext = {
  openToMentoring: boolean;
  openBlocks: string[];
  existing: { status: "pending" | "accepted" | "declined" | "withdrawn"; scheduledAt: string | null } | null;
};

const MAX_SLOTS = 3;
const SUGGESTIONS = 8;

/** "Request mentorship" button + form for someone else's profile. */
export function RequestMentorship({ mentorId, mentorName, ctx }: { mentorId: string; mentorName: string; ctx: RequestContext }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sent, setSent] = useState(false);
  const first = mentorName.split(" ")[0];

  if (ctx.existing?.status === "accepted" && ctx.existing.scheduledAt) {
    return (
      <Link className="btn" href="/mentorship" title="Your next session">
        <CalendarCheck className="ic" />
        <When iso={ctx.existing.scheduledAt} />
      </Link>
    );
  }
  if (ctx.existing?.status === "pending" || sent) {
    return (
      <Link className="btn" href="/mentorship">
        <Clock className="ic" />
        Request sent
      </Link>
    );
  }
  if (!ctx.openToMentoring) return null;

  return (
    <>
      <button type="button" className="btn" onClick={() => dialog.current?.showModal()}>
        <Handshake className="ic" />
        Request mentorship
      </button>
      <RequestDialog ref={dialog} mentorId={mentorId} first={first} openBlocks={ctx.openBlocks} onSent={() => setSent(true)} />
    </>
  );
}

function RequestDialog({
  ref,
  mentorId,
  first,
  openBlocks,
  onSent,
}: {
  ref: React.Ref<HTMLDialogElement>;
  mentorId: string;
  first: string;
  openBlocks: string[];
  onSent: () => void;
}) {
  const hydrated = useHydrated();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Suggested times come from their weekly blocks, in your timezone. Only computed after hydration.
  const suggestions = useMemo(
    () => (hydrated ? upcomingFromBlocks(openBlocks).slice(0, SUGGESTIONS).map((d) => d.toISOString()) : []),
    [hydrated, openBlocks],
  );
  const options = [...new Set([...suggestions, ...picked])].sort();

  const toggle = (iso: string) => {
    setError(null);
    setPicked((p) => (p.includes(iso) ? p.filter((x) => x !== iso) : p.length >= MAX_SLOTS ? p : [...p, iso]));
  };

  const addCustom = () => {
    if (!custom) return;
    const d = new Date(custom);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return setError("Pick a time in the future.");
    if (picked.length >= MAX_SLOTS) return setError(`You can suggest up to ${MAX_SLOTS} times.`);
    const iso = d.toISOString();
    setPicked((p) => (p.includes(iso) ? p : [...p, iso]));
    setCustom("");
    setError(null);
  };

  const reset = () => {
    setMessage("");
    setPicked([]);
    setCustom("");
    setError(null);
  };

  return (
    <dialog ref={ref} className="dlg" aria-labelledby="rq-title" onClose={reset}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const dlg = e.currentTarget.closest("dialog");
          if (message.trim().length < 10) return setError("Tell them a little more about what you want help with.");
          if (picked.length === 0) return setError("Suggest at least one time.");
          start(async () => {
            try {
              const res = await requestMentorship({ mentorId, message, slots: picked });
              if (!res.ok) return setError(res.error);
              dlg?.close();
              onSent();
            } catch {
              setError("Something went wrong. Try again.");
            }
          });
        }}
      >
        <div>
          <h2 id="rq-title">Ask {first} for a session</h2>
          <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
            Say what you want help with and suggest up to {MAX_SLOTS} times. {first} picks one or declines.
          </p>
        </div>

        <label className="sec" style={{ gap: 8 }}>
          <span className="lbl">What do you want to talk about?</span>
          <textarea
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            placeholder="I have a PM case round on the 30th. Could you walk me through how you'd structure it?"
            required
          />
        </label>

        <div className="sec" style={{ gap: 8 }}>
          <span className="lbl">
            Suggest times <span className="dim mono num">{picked.length} of {MAX_SLOTS}</span>
          </span>
          {options.length > 0 ? (
            <div className="tags">
              {options.map((iso) => (
                <button key={iso} type="button" className="tag sm" style={{ fontFamily: "var(--ax-mono)", fontSize: 12.5 }} aria-pressed={picked.includes(iso)} onClick={() => toggle(iso)}>
                  {picked.includes(iso) ? <Check className="ic" /> : null}
                  {formatSlot(iso)}
                  {picked.includes(iso) && !suggestions.includes(iso) ? <X className="ic" style={{ width: 14 }} /> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="dim" style={{ fontSize: 13 }}>
              {first} hasn&apos;t set open blocks yet, so add your own times below.
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" type="datetime-local" aria-label="Another time" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ colorScheme: "dark" }} />
            <button type="button" className="btn" onClick={addCustom} disabled={!custom || picked.length >= MAX_SLOTS}>
              <Plus className="ic" />
              Add
            </button>
          </div>
        </div>

        <div className="dlg-f">
          {error && (
            <span className="err-t" role="alert">
              <CircleAlert className="ic" />
              {error}
            </span>
          )}
          <button type="button" className="btn ghost" onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
