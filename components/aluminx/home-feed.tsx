"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, CircleAlert, FolderGit2, Handshake, Link2, Megaphone, Plus, ThumbsUp, Trash2, X } from "lucide-react";
import type { Feed, FeedPost, FeedScope } from "@/lib/feed";
import { createPost, deletePost, toggleLike } from "@/app/feed/actions";
import { ConnectButton } from "./connect-button";
import { PersonNode } from "./person-node";
import { relative, useNow } from "./when";

const KINDS = [
  { key: "update", label: "Update" },
  { key: "opportunity", label: "Opportunity" },
  { key: "referral", label: "Referral" },
  { key: "project", label: "Project" },
] as const;

type Kind = (typeof KINDS)[number]["key"] | "story";

export function HomeFeed({ feed, scope, college, me }: { feed: Feed; scope: FeedScope; college: string | null; me: { id: string; initials: string } }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const storyDialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<Kind>("update");

  const openStory = (i: number) => {
    setViewing(i);
    storyDialog.current?.showModal();
  };

  return (
    <main className="main" style={{ maxWidth: 820 }}>
      <div className="feed-h">
        <h1>Home</h1>
        <div className="seg" role="group" aria-label="Feed scope">
          <Link href="/" aria-current={scope === "foryou"}>
            For you
          </Link>
          <Link href="/?scope=college" aria-current={scope === "college"}>
            {college ?? "My college"}
          </Link>
          <Link href="/?scope=global" aria-current={scope === "global"}>
            Global
          </Link>
        </div>
      </div>

      <div className="live-row" aria-label="Stories">
        <button
          type="button"
          className="story"
          onClick={() => {
            setKind("story");
            composer.current?.focus();
          }}
        >
          <span className="add">
            <Plus className="ic" />
          </span>
          <small>Your story</small>
        </button>
        {feed.stories.map((g, i) => (
          <button key={g.author.id} type="button" className="story" onClick={() => openStory(i)} aria-label={`${g.author.name}'s story, ${g.posts.length} update${g.posts.length > 1 ? "s" : ""}`}>
            <PersonNode person={g.author} className="new" />
            <small>{g.author.id === me.id ? "You" : g.author.name.split(" ")[0]}</small>
          </button>
        ))}
      </div>

      <Composer ref={composer} kind={kind} setKind={setKind} initials={me.initials} />

      {feed.posts.length === 0 ? (
        <div className="empty">
          <Megaphone className="ic" />
          <b>Nothing here yet</b>
          <p>{scope === "global" ? "Be the first to post." : "Post something, or switch to Global to see the whole network."}</p>
          {scope !== "global" && (
            <Link className="btn sm" href="/?scope=global">
              See Global
            </Link>
          )}
        </div>
      ) : (
        <div className="thread">
          {feed.posts.map((p) => (
            <PostItem key={p.id} post={p} conn={feed.connections[p.author.id]} />
          ))}
        </div>
      )}

      <dialog ref={storyDialog} className="dlg story-view" aria-label="Story" onClose={() => setViewing(null)}>
        {viewing !== null && feed.stories[viewing] && (
          <StoryViewer
            group={feed.stories[viewing]}
            onNext={() => (viewing + 1 < feed.stories.length ? setViewing(viewing + 1) : storyDialog.current?.close())}
            onClose={() => storyDialog.current?.close()}
          />
        )}
      </dialog>
    </main>
  );
}

function Composer({ ref, kind, setKind, initials }: { ref: React.Ref<HTMLTextAreaElement>; kind: Kind; setKind: (k: Kind) => void; initials: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const story = kind === "story";

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await createPost({ kind, body, linkUrl: link, company }).catch(() => ({ ok: false as const, error: "Something went wrong." }));
          if (!res.ok) return setError(res.error);
          setBody("");
          setLink("");
          setCompany("");
          setKind("update");
          router.refresh();
        });
      }}
    >
      <span className="node you">{initials}</span>
      <div className="box">
        <textarea
          ref={ref}
          aria-label={story ? "Your story" : "Share an update"}
          placeholder={
            story
              ? "A quick story, gone in 24 hours…"
              : kind === "referral"
                ? "Who you can refer, for what role, and how to reach you…"
                : kind === "opportunity"
                  ? "An internship, gig or event people should know about…"
                  : kind === "project"
                    ? "What you built and what help you need…"
                    : "Share a win, a project or an ask…"
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={story ? 280 : 2000}
          rows={2}
        />
        <div className="row">
          <select className="input" aria-label="Post type" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
            <option value="story">Story (24h)</option>
          </select>
          {!story && <input className="input" type="url" placeholder="Link (optional)" aria-label="Link" value={link} onChange={(e) => setLink(e.target.value)} />}
          {(kind === "referral" || kind === "opportunity") && (
            <input className="input" placeholder={kind === "referral" ? "Company (required)" : "Company"} aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} />
          )}
          <button type="submit" className="btn sm primary" disabled={pending || !body.trim()} style={{ marginLeft: "auto" }}>
            {pending ? "Posting…" : story ? "Share story" : "Post"}
          </button>
        </div>
        {error && (
          <span className="err-t" role="alert">
            <CircleAlert className="ic" />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function PostItem({ post, conn }: { post: FeedPost; conn: Feed["connections"][string] | undefined }) {
  const router = useRouter();
  const now = useNow();
  const [pending, start] = useTransition();
  const [liked, setLiked] = useState(post.liked);
  const likes = post.likes + (liked === post.liked ? 0 : liked ? 1 : -1);
  const first = post.author.name.split(" ")[0];

  return (
    <article className={conn?.status === "connected" ? "tp live" : "tp"}>
      <Link href={post.mine ? "/profile" : `/profile/${post.author.id}`} aria-label={`Open ${post.author.name}'s profile`}>
        <PersonNode person={post.author} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <div className="tp-h">
          <div className="who">
            <Link href={post.mine ? "/profile" : `/profile/${post.author.id}`}>
              <b>{post.author.name}</b>
            </Link>
            <small>
              {[post.author.line, now ? relative(post.createdAt, now).replace(" ago", "") : null].filter(Boolean).join(". ")}
            </small>
          </div>
          {!post.mine && conn && <ConnectButton person={post.author} state={conn} size="sm" context={`their ${post.kind} post: "${post.body.slice(0, 120)}"`} />}
        </div>
        <p className="tp-body">{post.body}</p>

        {(post.kind === "referral" || post.kind === "opportunity") && (
          <div className="attach">
            <div className="t">
              <Briefcase className="ic" />
              {post.kind === "referral" ? "Referral" : "Opportunity"}
              {post.company && <span className="chip acc">{post.company}</span>}
              {post.kind === "referral" && (
                <span className="chip ok" style={{ marginLeft: "auto" }}>
                  referral open
                </span>
              )}
            </div>
            {post.linkUrl && <PostLink url={post.linkUrl} />}
            {!post.mine && (
              <div>
                <Link className="btn sm primary" href={`/messages?to=${post.author.id}`}>
                  {post.kind === "referral" ? `Ask ${first} for a referral` : `Ask ${first} about it`}
                </Link>
              </div>
            )}
          </div>
        )}
        {post.kind === "project" && post.linkUrl && (
          <div className="attach">
            <div className="t">
              <FolderGit2 className="ic" />
              <PostLink url={post.linkUrl} />
            </div>
          </div>
        )}
        {post.kind === "update" && post.linkUrl && (
          <div className="attach">
            <PostLink url={post.linkUrl} />
          </div>
        )}
        {!post.mine && post.author.openToMentoring && post.kind === "update" && (
          <div className="attach">
            <div className="t">
              <Handshake className="ic" />
              {first} is open to mentoring
            </div>
            <div>
              <Link className="btn sm" href={`/profile/${post.author.id}`}>
                Request a session
              </Link>
            </div>
          </div>
        )}

        <div className="acts">
          <button
            type="button"
            className="act"
            aria-pressed={liked}
            disabled={pending}
            onClick={() => {
              setLiked(!liked);
              start(async () => {
                const res = await toggleLike(post.id).catch(() => ({ ok: false }));
                if (!res.ok) setLiked(liked);
              });
            }}
          >
            <ThumbsUp className="ic" />
            <span className="num">{likes}</span>
            <span className="sr">{liked ? "Remove appreciation" : "Appreciate"}</span>
          </button>
          {post.mine && (
            <button
              type="button"
              className="act"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this post?")) return;
                start(async () => {
                  await deletePost(post.id).catch(() => null);
                  router.refresh();
                });
              }}
            >
              <Trash2 className="ic" />
              Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function PostLink({ url }: { url: string }) {
  let label = url;
  try {
    const u = new URL(url);
    label = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {}
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
      <Link2 className="ic" style={{ fontSize: 15 }} />
      {label.length > 60 ? `${label.slice(0, 57)}…` : label}
    </a>
  );
}

function StoryViewer({ group, onNext, onClose }: { group: Feed["stories"][number]; onNext: () => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const now = useNow();
  const story = group.posts[i];
  const next = () => (i + 1 < group.posts.length ? setI(i + 1) : onNext());

  return (
    <div className="sv" style={{ "--h": group.author.hue } as React.CSSProperties}>
      <div className="bar" aria-hidden="true">
        {group.posts.map((p, j) => (
          <i key={p.id} className={j <= i ? "on" : ""} />
        ))}
      </div>
      <div className="person">
        <PersonNode person={group.author} size="sm" />
        <div>
          <b>{group.author.name}</b>
          <small>{now ? relative(story.createdAt, now) : ""}</small>
        </div>
        <button type="button" className="btn sm icon ghost" aria-label="Close" onClick={onClose}>
          <X className="ic" />
        </button>
      </div>
      <p className="body">{story.body}</p>
      <div className="btns" style={{ marginTop: "auto" }}>
        {!story.mine && (
          <Link className="btn sm" href={`/messages?to=${group.author.id}`}>
            Reply
          </Link>
        )}
        <button type="button" className="btn sm primary" onClick={next} autoFocus>
          Next
        </button>
      </div>
    </div>
  );
}
