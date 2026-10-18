// Mentorship constants and helpers shared by server actions and client components.

export const DECLINE_REASONS = ["Not my area", "No time this month", "Suggest someone else"] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const BLOCKS = [
  { label: "AM", name: "morning", hour: 10 },
  { label: "PM", name: "afternoon", hour: 15 },
  { label: "Eve", name: "evening", hour: 19 },
] as const;

/** "<day>-<slot>" with day 0 = Mon .. 6 = Sun and slot 0..2 (see BLOCKS). */
export const blockKey = (day: number, slot: number) => `${day}-${slot}`;

/**
 * Concrete start times in the viewer's timezone for a mentor's weekly open
 * blocks, from tomorrow onwards. Used to suggest times on the request form.
 */
export function upcomingFromBlocks(blocks: string[], days = 14, from = new Date()): Date[] {
  const set = new Set(blocks);
  const out: Date[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const day = (d.getDay() + 6) % 7; // JS Sunday = 0 -> our Monday = 0
    BLOCKS.forEach((b, slot) => {
      if (set.has(blockKey(day, slot))) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), b.hour));
    });
  }
  return out;
}

/** "Mornings: Sat. Evenings: Tue, Thu", or null when there are no blocks. */
export function summarizeBlocks(blocks: string[]): string | null {
  if (blocks.length === 0) return null;
  return BLOCKS.map((b, slot) => {
    const days = DAYS.filter((_, day) => blocks.includes(blockKey(day, slot)));
    return days.length ? `${b.name[0].toUpperCase()}${b.name.slice(1)}s: ${days.length === 7 ? "every day" : days.join(", ")}` : null;
  })
    .filter(Boolean)
    .join(". ");
}
