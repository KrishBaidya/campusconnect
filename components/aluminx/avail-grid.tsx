"use client";

import { BLOCKS, DAYS, blockKey } from "@/lib/mentorship-shared";

/** The Mon-Sun x AM/PM/Eve grid from the mockups. Read-only unless `onToggle` is given. */
export function AvailGrid({ blocks, onToggle }: { blocks: string[]; onToggle?: (key: string) => void }) {
  const on = new Set(blocks);
  return (
    <div className={onToggle ? "avail" : "avail ro"} role={onToggle ? "group" : "img"} aria-label={onToggle ? "Weekly open blocks" : describe(blocks)}>
      <span />
      {DAYS.map((d) => (
        <span key={d} aria-hidden="true">
          {d[0]}
        </span>
      ))}
      {BLOCKS.map((b, slot) => (
        <Row key={b.label} label={b.label}>
          {DAYS.map((d, day) => {
            const key = blockKey(day, slot);
            return onToggle ? (
              <button key={key} type="button" className="cell" aria-pressed={on.has(key)} aria-label={`${d} ${b.name}`} onClick={() => onToggle(key)} />
            ) : (
              <span key={key} className={on.has(key) ? "cell on" : "cell"} aria-hidden="true" />
            );
          })}
        </Row>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="rl" aria-hidden="true">
        {label}
      </span>
      {children}
    </>
  );
}

function describe(blocks: string[]) {
  if (blocks.length === 0) return "No open blocks set";
  return `Open ${blocks
    .map((k) => {
      const [d, s] = k.split("-").map(Number);
      return `${DAYS[d]} ${BLOCKS[s].name}`;
    })
    .join(", ")}`;
}
