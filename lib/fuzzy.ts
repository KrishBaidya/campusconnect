// Typo-tolerant matching for the Discover search box ("pyhton" finds Python,
// "razorpy" finds Razorpay). Runs in the browser over each card's keywords.

/** Edit distance where a swap of two neighbouring letters counts as one edit ("pyhton" -> "python"). Stops early past `max`. */
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

export const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);

/** Edits allowed for a query word: none for short words, 1 for 4-7 letters, 2 beyond. */
const allowance = (w: string) => (w.length < 4 ? 0 : w.length < 8 ? 1 : 2);

/** True when every query word appears in `haystack`, exactly, as a prefix, or within a typo or two of a word. */
export function fuzzyMatch(query: string, haystack: string, words: string[] = tokenize(haystack)) {
  const q = tokenize(query);
  if (q.length === 0) return true;
  return q.every((w) => {
    if (haystack.includes(w)) return true;
    const max = allowance(w);
    return max > 0 && words.some((t) => t.startsWith(w.slice(0, -1)) || distance(w, t.slice(0, w.length + max), max) <= max);
  });
}
