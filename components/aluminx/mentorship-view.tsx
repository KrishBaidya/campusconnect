"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Ban, CalendarCheck, CalendarClock, Check, CircleAlert, Clock, MessageCircle, Plus, Send, SlidersHorizontal, Undo2, X } from "lucide-react";
import type { MentorshipData, MentorshipItem } from "@/lib/mentorship";
import { DECLINE_REASONS, summarizeBlocks } from "@/lib/mentorship-shared";
import { acceptRequest, declineRequest, saveSlotSettings, withdrawRequest, type ActionResult } from "@/app/mentorship/actions";
import { AvailGrid } from "./avail-grid";
import { PersonNode } from "./person-node";
import { When, relative, useNow } from "./when";

type Tab = "incoming" | "mentees" | "mentors" | "sent";

export function MentorshipView({ data, me }: { data: MentorshipData; me: { initials: string } }) {
  const [tab, setTab] = useState<Tab>(data.incoming.length > 0 || data.mentees.length > 0 ? "incoming" : "mentors");
  const settings = useRef<HTMLDialogElement>(null);

  const tabs: { key: Tab; label: string; n: number; warn?: boolean }[] = [
    { key: "incoming", label: "Requests to you", n: data.incoming.length, warn: data.incoming.length > 0 },
    { key: "mentees", label: "Your mentees", n: data.mentees.length },
    { key: "mentors", label: "Your mentors", n: data.mentors.length },
    { key: "sent", label: "Sent", n: data.sent.filter((s) => s.status === "pending").length },
  ];

  return (
    <main className="main">
      <div className="page-h">
        <h1>Mentorship</h1>
        <button type="button" className="btn sm" onClick={() => settings.current?.showModal()}>
          <SlidersHorizontal className="ic" />
          Slot settings
        </button>
      </div>

      <div className="ment">
        <div style={{ minWidth: 0 }}>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                {t.label}
                <span className={t.warn ? "chip xs warn num" : "chip xs num"}>{t.n}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "incoming" &&
              (data.incoming.length ? (
                <div className="rqs">
                  {data.incoming.map((r) => (
                    <IncomingCard key={r.id} r={r} me={me} full={data.bookedThisMonth >= data.capacity} />
                  ))}
                </div>
              ) : (
                <Empty icon={<CalendarClock className="ic" />} title="No requests right now">
                  {data.capacity > 0
                    ? "People who want your time will show up here. Keep your open blocks current so they can suggest times that work."
                    : "Your slots are set to 0, so nobody can request you. Raise them in Slot settings."}
                </Empty>
              ))}

            {tab === "mentees" &&
              (data.mentees.length ? (
                <div className="rqs">
                  {data.mentees.map((r) => (
                    <SessionCard key={r.id} r={r} me={me} youAre="mentor" />
                  ))}
                </div>
              ) : (
                <Empty icon={<CalendarCheck className="ic" />} title="No mentees yet">
                  Requests you accept become sessions here.
                </Empty>
              ))}

            {tab === "mentors" &&
              (data.mentors.length ? (
                <div className="rqs">
                  {data.mentors.map((r) => (
                    <SessionCard key={r.id} r={r} me={me} youAre="mentee" />
                  ))}
                </div>
              ) : (
                <FindMentor />
              ))}

            {tab === "sent" &&
              (data.sent.length ? (
                <div className="rqs">
                  {data.sent.map((r) => (
                    <SentCard key={r.id} r={r} me={me} />
                  ))}
                </div>
              ) : (
                <FindMentor />
              ))}
          </div>
        </div>

        <aside style={{ display: "grid", gap: 36, alignContent: "start" }}>
          <div className="sec">
            <h3>Your slots this month</h3>
            <CapRail capacity={data.capacity} booked={data.bookedThisMonth} />
            <p className="muted" style={{ fontSize: 14 }}>
              {data.capacity === 0 ? (
                "Not taking requests"
              ) : (
                <>
                  <span className="mono num">{Math.min(data.bookedThisMonth, data.capacity)}</span> of {data.capacity} booked
                </>
              )}
            </p>
          </div>
          <div className="sec">
            <h3>Your open blocks</h3>
            <AvailGrid blocks={data.openBlocks} />
            <p className="dim" style={{ fontSize: 13 }}>
              {summarizeBlocks(data.openBlocks) ?? "None set. People can still suggest any time."}
            </p>
          </div>
        </aside>
      </div>

      <SlotSettings key={`${data.capacity}:${data.openBlocks.join()}`} ref={settings} capacity={data.capacity} blocks={data.openBlocks} />
    </main>
  );
}

/* ------------------------------------------------------------------ */

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (res.ok) onOk?.();
        else setError(res.error);
      } catch {
        setError("Something went wrong. Try again.");
      }
    });
  return { pending, error, setError, run };
}

function Link2({ r, me, closed }: { r: MentorshipItem; me: { initials: string }; closed?: boolean }) {
  return (
    <div className="rq-link">
      <Link href={`/profile/${r.other.id}`} aria-label={`Open ${r.other.name}'s profile`}>
        <PersonNode person={r.other} />
      </Link>
      <span className="rq-rail">{!closed && <i />}</span>
      <span className="node you sm" aria-hidden="true">
        {me.initials}
      </span>
    </div>
  );
}

function Who({ r }: { r: MentorshipItem }) {
  return (
    <div>
      <Link href={`/profile/${r.other.id}`}>
        <b>{r.other.name}</b>
      </Link>
      <small>{[r.other.title, r.other.meta].filter(Boolean).join(". ") || "AluminX member"}</small>
    </div>
  );
}

function IncomingCard({ r, me, full }: { r: MentorshipItem; me: { initials: string }; full: boolean }) {
  const now = useNow();
  const [slot, setSlot] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const { pending, error, setError, run } = useAction();
  const first = r.other.name.split(" ")[0];

  const accept = () => {
    if (!slot) {
      setError(`Pick one of ${first}'s times first`);
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    run(() => acceptRequest(r.id, slot));
  };

  return (
    <article className={shake ? "rq shake" : "rq"}>
      <div className="rq-h">
        <Link2 r={r} me={me} />
        <Who r={r} />
        <span className="chip warn">
          <Clock className="ic" style={{ fontSize: 13 }} />
          {now ? `asked ${relative(r.createdAt, now)}` : "waiting"}
        </span>
      </div>
      <blockquote>{r.message}</blockquote>

      {declining ? (
        <div className="decline-box">
          <span className="lbl">Tell {first} why (optional)</span>
          <div className="tags" role="group" aria-label="Reason">
            {DECLINE_REASONS.map((why) => (
              <button key={why} type="button" className="tag sm" aria-pressed={reason === why} onClick={() => setReason(reason === why ? null : why)}>
                <Check className="ic" />
                {why}
              </button>
            ))}
          </div>
          <div className="btns">
            <button type="button" className="btn sm danger" disabled={pending} onClick={() => run(() => declineRequest(r.id, reason))}>
              Decline request
            </button>
            <button type="button" className="btn sm ghost" disabled={pending} onClick={() => setDeclining(false)}>
              Keep it
            </button>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </div>
      ) : (
        <>
          {r.slots.length > 0 ? (
            <div className="slots tags" role="group" aria-label="Suggested times">
              {r.slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="tag sm"
                  aria-pressed={slot === s}
                  onClick={() => {
                    setSlot(s);
                    setError(null);
                  }}
                >
                  <Check className="ic" />
                  <When iso={s} />
                </button>
              ))}
            </div>
          ) : (
            <p className="note">
              <CircleAlert className="ic" />
              All of {first}&apos;s suggested times have passed. Message them to find a new one, or decline.
            </p>
          )}
          <div className="rq-f">
            <button type="button" className="btn primary sm" disabled={pending || r.slots.length === 0 || full} onClick={accept} title={full ? "Your slots this month are full" : undefined}>
              <Check className="ic" />
              Accept
            </button>
            <button type="button" className="btn sm danger" disabled={pending} onClick={() => setDeclining(true)}>
              <X className="ic" />
              Decline
            </button>
            <Link className="btn sm ghost" href={`/messages?to=${r.other.id}`}>
              <MessageCircle className="ic" />
              Reply first
            </Link>
            {error ? <ErrorText>{error}</ErrorText> : full ? <ErrorText>Your slots this month are full</ErrorText> : null}
          </div>
        </>
      )}
    </article>
  );
}

function SessionCard({ r, me, youAre }: { r: MentorshipItem; me: { initials: string }; youAre: "mentor" | "mentee" }) {
  const now = useNow();
  const upcoming = now && r.scheduledAt ? new Date(r.scheduledAt).getTime() > now : true;
  return (
    <article className="rq accepted">
      <div className="rq-h">
        <Link2 r={r} me={me} />
        <Who r={r} />
        <span className="chip ok">{youAre === "mentor" ? "your mentee" : "your mentor"}</span>
      </div>
      <div className="note ok">
        <CalendarCheck className="ic" />
        <span>
          {upcoming ? "Next session: " : "Last session: "}
          {r.scheduledAt && <When iso={r.scheduledAt} />}
          {now && r.scheduledAt && upcoming ? <span className="dim"> ({relative(r.scheduledAt, now)})</span> : null}
        </span>
      </div>
      <blockquote style={{ fontSize: 14, color: "var(--fg-2)" }}>{r.message}</blockquote>
      <div className="rq-f">
        <Link className="btn sm" href={`/messages?to=${r.other.id}`}>
          <MessageCircle className="ic" />
          Message
        </Link>
      </div>
    </article>
  );
}

function SentCard({ r, me }: { r: MentorshipItem; me: { initials: string } }) {
  const { pending, error, run } = useAction();
  const first = r.other.name.split(" ")[0];
  const closed = r.status !== "pending";
  return (
    <article className={closed ? "rq closed" : "rq"}>
      <div className="rq-h">
        <Link2 r={r} me={me} closed={closed} />
        <Who r={r} />
        <span className={r.status === "pending" ? "chip warn" : "chip"}>{r.status === "pending" ? "awaiting reply" : r.status}</span>
      </div>
      <blockquote>{r.message}</blockquote>
      {r.status === "pending" ? (
        <>
          {r.slots.length > 0 && (
            <div className="slots tags" aria-label="Times you suggested">
              {r.slots.map((s) => (
                <span key={s} className="tag sm static">
                  <When iso={s} />
                </span>
              ))}
            </div>
          )}
          <div className="rq-f">
            <button type="button" className="btn sm ghost" disabled={pending} onClick={() => run(() => withdrawRequest(r.id))}>
              <Undo2 className="ic" />
              Withdraw
            </button>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </>
      ) : (
        <p className="note">
          <Ban className="ic" />
          {r.status === "declined"
            ? `${first} declined${r.declineReason ? `: ${r.declineReason.toLowerCase()}` : ""}.`
            : "You withdrew this request."}
        </p>
      )}
    </article>
  );
}

function CapRail({ capacity, booked }: { capacity: number; booked: number }) {
  if (capacity === 0) return null;
  return (
    <div className="caprail" role="img" aria-label={`${Math.min(booked, capacity)} of ${capacity} slots booked`}>
      {Array.from({ length: capacity }, (_, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className={i < booked ? "s on" : "s"} />}
          <span className={i < booked ? "n on" : "n"}>{i < booked ? <Check className="ic" /> : <Plus className="ic" />}</span>
        </span>
      ))}
    </div>
  );
}

function SlotSettings({ ref, capacity, blocks }: { ref: React.Ref<HTMLDialogElement>; capacity: number; blocks: string[] }) {
  const [cap, setCap] = useState(capacity);
  const [open, setOpen] = useState(blocks);
  const { pending, error, run } = useAction();
  const close = (e: React.SyntheticEvent) => (e.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close();

  return (
    <dialog ref={ref} className="dlg" aria-labelledby="slot-title" onClose={() => (setCap(capacity), setOpen(blocks))}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const dlg = e.currentTarget.closest("dialog");
          run(() => saveSlotSettings({ capacity: cap, blocks: open }), () => dlg?.close());
        }}
      >
        <h2 id="slot-title">Slot settings</h2>
        <div className="sec" style={{ gap: 8 }}>
          <span className="lbl">Sessions per month</span>
          <div className="num-in">
            <button type="button" className="btn sm icon" aria-label="Fewer" disabled={cap <= 0} onClick={() => setCap((c) => Math.max(0, c - 1))}>
              −
            </button>
            <b className="num" aria-live="polite">
              {cap}
            </b>
            <button type="button" className="btn sm icon" aria-label="More" disabled={cap >= 12} onClick={() => setCap((c) => Math.min(12, c + 1))}>
              +
            </button>
            <span className="dim" style={{ fontSize: 13, marginLeft: 6 }}>
              {cap === 0 ? "Nobody can request you" : "Requests stop once these are booked"}
            </span>
          </div>
        </div>
        <div className="sec" style={{ gap: 8 }}>
          <span className="lbl">When are you usually free?</span>
          <AvailGrid blocks={open} onToggle={(k) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))} />
          <span className="dim" style={{ fontSize: 13 }}>
            Mentees see these as suggested times. Mornings start at 10, afternoons at 3, evenings at 7.
          </span>
        </div>
        <div className="dlg-f">
          {error && <ErrorText>{error}</ErrorText>}
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function FindMentor() {
  return (
    <Empty icon={<Send className="ic" />} title="You have not asked anyone yet" action={<Link className="btn primary sm" href="/discover">Find a mentor</Link>}>
      Find alumni who are open to mentoring and request a slot from their profile.
    </Empty>
  );
}

function Empty({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <b>{title}</b>
      <p>{children}</p>
      {action}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <span className="err-t" role="alert">
      <CircleAlert className="ic" />
      {children}
    </span>
  );
}
