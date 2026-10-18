"use client";

import { useState, useTransition } from "react";
import { CircleAlert, Plus, X } from "lucide-react";
import { joinClub, leaveClub } from "@/app/clubs/actions";

/** Your own clubs, with add/remove. `suggestions` are clubs others at your college already listed. */
export function ClubsEditor({ clubs, suggestions }: { clubs: string[]; suggestions: string[] }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = new Set(clubs.map((c) => c.toLowerCase()));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn().catch(() => ({ ok: false, error: "Something went wrong." }));
      if (res.ok) after?.();
      else setError(res.error ?? "Something went wrong.");
    });

  return (
    <div className="sec">
      <h3>Clubs</h3>
      {clubs.length > 0 && (
        <div className="tags">
          {clubs.map((c) => (
            <span key={c} className="tag sm static" style={{ paddingRight: 4 }}>
              {c}
              <button type="button" className="btn sm icon ghost" style={{ width: 22, height: 22 }} aria-label={`Leave ${c}`} disabled={pending} onClick={() => run(() => leaveClub(c))}>
                <X className="ic" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        style={{ display: "flex", gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => joinClub(name), () => setName(""));
        }}
      >
        <input
          className="input"
          style={{ height: 34, fontSize: 13.5 }}
          list="club-suggestions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={clubs.length ? "Add another club" : "Add a club, e.g. Finance club"}
          aria-label="Club name"
          maxLength={60}
        />
        <datalist id="club-suggestions">
          {suggestions
            .filter((s) => !mine.has(s.toLowerCase()))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
        <button type="submit" className="btn sm" disabled={pending || !name.trim()}>
          <Plus className="ic" />
          Add
        </button>
      </form>
      {error && (
        <span className="err-t" role="alert">
          <CircleAlert className="ic" />
          {error}
        </span>
      )}
    </div>
  );
}
