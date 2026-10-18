// Point rules, shared by the server (awarding) and the UI ("How points work").

export const POINTS = {
  profile_complete: { points: 10, label: "Finished your profile" },
  connection: { points: 5, label: "New connection" },
  quick_reply: { points: 10, label: "Replied within 48 hours" },
  mentorship_accepted: { points: 20, label: "Took on a mentorship session" },
  session_booked: { points: 5, label: "Booked a mentorship session" },
  post: { points: 2, label: "Shared a post" },
} as const;

export type PointReasonKey = keyof typeof POINTS;

/** Posts only earn points this many times a day, so the feed isn't spammed for points. */
export const POST_POINTS_PER_DAY = 3;
