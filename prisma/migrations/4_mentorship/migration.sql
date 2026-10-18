-- =====================================================================
-- Mentorship — a mentee asks a mentor for a session and proposes up to
-- three times; the mentor accepts one of them or declines. Writes go
-- through server actions (Prisma), so the API roles only get read access.
-- Matches the MentorshipRequest model and the new Profile columns.
-- =====================================================================

-- 1. Mentor settings on the profile
ALTER TABLE "profiles"
    ADD COLUMN "mentor_capacity" INTEGER NOT NULL DEFAULT 4,
    -- weekly blocks the mentor is usually free, "<day>-<slot>":
    -- day 0 = Mon .. 6 = Sun, slot 0 = morning, 1 = afternoon, 2 = evening
    ADD COLUMN "open_blocks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD CONSTRAINT "profiles_mentor_capacity_range" CHECK ("mentor_capacity" BETWEEN 0 AND 12);

-- 2. Requests
CREATE TYPE "mentorship_status" AS ENUM ('pending', 'accepted', 'declined', 'withdrawn');

CREATE TABLE "mentorship_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mentee_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "proposed_slots" TIMESTAMPTZ(6)[] NOT NULL,
    "status" "mentorship_status" NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMPTZ(6),
    "decline_reason" TEXT,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "mentorship_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mentorship_requests_not_self" CHECK ("mentee_id" <> "mentor_id"),
    CONSTRAINT "mentorship_requests_message_length" CHECK (char_length(btrim("message")) BETWEEN 10 AND 1000),
    CONSTRAINT "mentorship_requests_slot_count" CHECK (cardinality("proposed_slots") BETWEEN 1 AND 3),
    CONSTRAINT "mentorship_requests_scheduled" CHECK (("status" = 'accepted') = ("scheduled_at" IS NOT NULL))
);

CREATE INDEX "mentorship_requests_mentor_id_status_idx" ON "mentorship_requests"("mentor_id", "status");
CREATE INDEX "mentorship_requests_mentee_id_status_idx" ON "mentorship_requests"("mentee_id", "status");
-- only one open request between the same two people at a time
CREATE UNIQUE INDEX "mentorship_requests_one_pending" ON "mentorship_requests"("mentee_id", "mentor_id") WHERE "status" = 'pending';

ALTER TABLE "mentorship_requests" ADD CONSTRAINT "mentorship_requests_mentee_id_fkey" FOREIGN KEY ("mentee_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentorship_requests" ADD CONSTRAINT "mentorship_requests_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Row Level Security — the two people involved can read a request (the
--    Messages side panel lists sessions with supabase-js). No write policies:
--    requests are created and answered by server actions.
alter table public.mentorship_requests enable row level security;

create policy "read own mentorship requests" on public.mentorship_requests
  for select to authenticated
  using ((select auth.uid()) in (mentee_id, mentor_id));
