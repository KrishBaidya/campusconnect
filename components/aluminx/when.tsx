"use client";

import { useSyncExternalStore } from "react";

// Dates are rendered in the viewer's timezone, which the server doesn't know.
// Rendering them only after hydration avoids server/client text mismatches.

const subscribe = () => () => {};
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

// One shared clock that ticks every minute, so "in 3h" labels stay fresh and
// render code never calls Date.now() itself. 0 on the server.
let clock = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    clock = Date.now();
    timer = setInterval(() => {
      clock = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
/** Current time in ms after hydration (refreshed each minute), 0 during SSR. */
export function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => clock || (clock = Date.now()),
    () => 0,
  );
}

/** "Tue 29 Oct, 6:30 PM" */
export function formatSlot(iso: string | Date) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** "in 6d", "in 3h", "2h ago", "1d ago" */
export function relative(iso: string | Date, now: number) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const v = abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))}m` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)}h` : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `in ${v}` : `${v} ago`;
}

/** A timestamp rendered on the client only; `fallback` holds its place during SSR. */
export function When({ iso, format = formatSlot, fallback = "…" }: { iso: string; format?: (iso: string) => string; fallback?: string }) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{hydrated ? format(iso) : fallback}</time>;
}
