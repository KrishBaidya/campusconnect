-- =====================================================================
-- AluminX — full database setup for Supabase
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Matches prisma/schema.prisma exactly.
-- =====================================================================

-- 0. (Optional) remove the old dashboard table first.
--    Check its name in Table Editor; only run this if it has no real data.
-- drop table if exists public.profiles cascade;

-- 1. pgvector for embeddings / similarity search
create extension if not exists vector with schema extensions;
set search_path = public, extensions;

-- 2. Tables (generated from the Prisma schema)
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('student', 'alumni');

-- CreateTable
CREATE TABLE "colleges" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,

    CONSTRAINT "colleges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "user_role",
    "first_name" TEXT,
    "last_name" TEXT,
    "avatar_url" TEXT,
    "headline" TEXT,
    "bio" TEXT,
    "college_id" UUID,
    "department" TEXT,
    "batch_year" INTEGER,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" JSONB,
    "achievements" JSONB NOT NULL DEFAULT '[]',
    "github_url" TEXT,
    "github_username" TEXT,
    "linkedin_url" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "projects" JSONB NOT NULL DEFAULT '[]',
    "onboarded_at" TIMESTAMPTZ(6),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "job_role" TEXT,
    "start_date" DATE,
    "end_date" DATE,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_embeddings" (
    "profile_id" UUID NOT NULL,
    "embedding" vector(768),
    "source" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_embeddings_pkey" PRIMARY KEY ("profile_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colleges_name_key" ON "colleges"("name");

-- CreateIndex
CREATE INDEX "profiles_college_id_idx" ON "profiles"("college_id");

-- CreateIndex
CREATE INDEX "profiles_role_idx" ON "profiles"("role");

-- CreateIndex
CREATE INDEX "experiences_profile_id_idx" ON "experiences"("profile_id");

-- CreateIndex
CREATE INDEX "experiences_company_idx" ON "experiences"("company");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_embeddings" ADD CONSTRAINT "profile_embeddings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Supabase auth link, sign-up trigger, security rules, matching
-- 1. Link profiles to Supabase Auth users (deleting a user deletes the profile)
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- 2. Every new sign-up gets an empty profile automatically
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Row Level Security — protects data read through the Supabase client (supabase-js).
--    NOTE: Prisma connects as the database owner and BYPASSES these rules.
alter table public.profiles    enable row level security;
alter table public.experiences enable row level security;
alter table public.colleges    enable row level security;

create policy "read profiles" on public.profiles
  for select to authenticated using (true);
create policy "edit own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);

create policy "read experiences" on public.experiences
  for select to authenticated using (true);
create policy "manage own experiences" on public.experiences
  for all to authenticated
  using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create policy "read colleges" on public.colleges
  for select to authenticated using (true);

-- 4. pgvector: fast similarity index + a matching function
alter table public.profile_embeddings enable row level security;
-- (no policies: only the server, via Prisma, reads or writes embeddings)

create index if not exists profile_embeddings_hnsw
  on public.profile_embeddings using hnsw (embedding vector_cosine_ops);

-- Top matches for one user. scope: 'college' = same college only, 'global' = everyone.
-- (same as prisma/migrations/3_match_profiles/migration.sql)
-- Load pgvector in this session first: without it Postgres treats
-- hnsw.iterative_scan as an unknown setting and refuses the SET below.
select '[0]'::extensions.vector;

create or replace function public.match_profiles(
  p_user_id uuid,
  p_scope   text default 'global',
  p_limit   int  default 10
)
returns table (profile_id uuid, similarity float)
language sql stable
set search_path = public, extensions
set hnsw.iterative_scan = relaxed_order
as $$
  with nearest as materialized (
    select e.profile_id,
           e.embedding <=> (select embedding from profile_embeddings where profile_id = p_user_id) as distance
    from profile_embeddings e
    join profiles p on p.id = e.profile_id
    where e.profile_id <> p_user_id
      and e.embedding is not null
      and (p_scope = 'global'
           or p.college_id = (select college_id from profiles where id = p_user_id))
    order by e.embedding <=> (select embedding from profile_embeddings where profile_id = p_user_id)
    limit p_limit
  )
  -- relaxed_order can return near-ties slightly out of order, so re-sort the few rows.
  -- "+ 0" stops Postgres 17+ from assuming the CTE is already sorted and skipping it.
  select profile_id, 1 - distance as similarity
  from nearest
  order by distance + 0;
$$;

-- Embeddings are server-only (read through Prisma), so keep this off the public API.
revoke execute on function public.match_profiles(uuid, text, int) from public, anon, authenticated;

-- =====================================================================
-- 5. Messages (same as prisma/migrations/2_messages/migration.sql)
-- =====================================================================
-- 1. Tables
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_a" UUID NOT NULL,
    "user_b" UUID NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    -- one row per pair: the smaller uuid is always user_a
    CONSTRAINT "conversations_ordered_pair" CHECK ("user_a" < "user_b")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 4000)
);

CREATE UNIQUE INDEX "conversations_user_a_user_b_key" ON "conversations"("user_a", "user_b");
CREATE INDEX "conversations_user_b_idx" ON "conversations"("user_b");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Row Level Security — members of a conversation can read it and post in it.
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

create policy "read own conversations" on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
-- (no insert policy: conversations are created through start_conversation())

create policy "read messages in own conversations" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
  ));

create policy "send messages in own conversations" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

-- The recipient may mark messages as read — and change nothing else.
create policy "mark received messages read" on public.messages
  for update to authenticated
  using (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- 3. Find or create the conversation between the caller and another user.
create or replace function public.start_conversation(p_other_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if p_other_id is null or p_other_id = v_me then raise exception 'invalid recipient'; end if;
  if not exists (select 1 from public.profiles where id = p_other_id) then
    raise exception 'recipient not found';
  end if;

  insert into public.conversations (user_a, user_b)
  values (least(v_me, p_other_id), greatest(v_me, p_other_id))
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into v_id;

  return v_id;
end; $$;

revoke execute on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- 4. Keep conversations sorted by latest activity.
create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end; $$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- 5. Realtime — stream inserts/updates to subscribed clients (RLS still applies).
alter publication supabase_realtime add table public.messages, public.conversations;

-- =====================================================================
-- 6. Mentorship (prisma/migrations/4_mentorship)
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

-- =====================================================================
-- 7. Network: connections, posts, clubs, points (prisma/migrations/5_network)
-- =====================================================================
-- 1. Enums
CREATE TYPE "connection_status" AS ENUM ('pending', 'accepted', 'declined');
CREATE TYPE "post_kind" AS ENUM ('update', 'opportunity', 'referral', 'project', 'story');
CREATE TYPE "point_reason" AS ENUM ('profile_complete', 'connection', 'quick_reply', 'mentorship_accepted', 'session_booked', 'post');

-- 2. Connections — one row per pair; whoever asked first is the requester
CREATE TABLE "connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requester_id" UUID NOT NULL,
    "addressee_id" UUID NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connections_not_self" CHECK ("requester_id" <> "addressee_id"),
    CONSTRAINT "connections_message_length" CHECK ("message" IS NULL OR char_length("message") <= 600)
);
CREATE UNIQUE INDEX "connections_pair_key" ON "connections" (LEAST("requester_id", "addressee_id"), GREATEST("requester_id", "addressee_id"));
CREATE INDEX "connections_requester_id_status_idx" ON "connections"("requester_id", "status");
CREATE INDEX "connections_addressee_id_status_idx" ON "connections"("addressee_id", "status");
ALTER TABLE "connections" ADD CONSTRAINT "connections_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connections" ADD CONSTRAINT "connections_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Posts and stories (stories expire after 24h)
CREATE TABLE "posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" UUID NOT NULL,
    "college_id" UUID,
    "kind" "post_kind" NOT NULL DEFAULT 'update',
    "body" TEXT NOT NULL,
    "link_url" TEXT,
    "company" TEXT,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "posts_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000),
    CONSTRAINT "posts_link_url" CHECK ("link_url" IS NULL OR "link_url" ~* '^https?://'),
    CONSTRAINT "posts_story_expires" CHECK (("kind" = 'story') = ("expires_at" IS NOT NULL))
);
CREATE INDEX "posts_created_at_idx" ON "posts"("created_at");
CREATE INDEX "posts_college_id_created_at_idx" ON "posts"("college_id", "created_at");
CREATE INDEX "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at");
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "posts" ADD CONSTRAINT "posts_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "post_likes" (
    "post_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("post_id", "profile_id")
);
CREATE INDEX "post_likes_profile_id_idx" ON "post_likes"("profile_id");
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Clubs, per college
CREATE TABLE "clubs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "college_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clubs_name_length" CHECK (char_length(btrim("name")) BETWEEN 2 AND 60)
);
CREATE UNIQUE INDEX "clubs_college_id_name_key" ON "clubs"("college_id", "name");
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "club_members" (
    "club_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_members_pkey" PRIMARY KEY ("club_id", "profile_id")
);
CREATE INDEX "club_members_profile_id_idx" ON "club_members"("profile_id");
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Points — an append-only ledger; profiles.points is kept in sync by a trigger.
--    (reason, ref_id) is unique per person so the same event never pays twice.
CREATE TABLE "point_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "reason" "point_reason" NOT NULL,
    "points" INTEGER NOT NULL,
    "ref_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "point_events_profile_id_reason_ref_id_key" ON "point_events"("profile_id", "reason", "ref_id");
CREATE INDEX "point_events_profile_id_created_at_idx" ON "point_events"("profile_id", "created_at");
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "profiles_points_idx" ON "profiles"("points");

create or replace function public.apply_point_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set points = points + new.points where id = new.profile_id;
  return new;
end; $$;

drop trigger if exists on_point_event on public.point_events;
create trigger on_point_event
  after insert on public.point_events
  for each row execute function public.apply_point_event();

-- Quick replies: the first time someone answers a conversation within 48h of
-- the other person's first message, they earn 10 points (once per conversation).
create or replace function public.award_quick_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first_other timestamptz;
begin
  if exists (
    select 1 from public.messages
    where conversation_id = new.conversation_id and sender_id = new.sender_id and id <> new.id
  ) then
    return new; -- not their first message here
  end if;

  select min(created_at) into v_first_other from public.messages
  where conversation_id = new.conversation_id and sender_id <> new.sender_id;

  if v_first_other is not null and new.created_at - v_first_other <= interval '48 hours' then
    insert into public.point_events (profile_id, reason, points, ref_id)
    values (new.sender_id, 'quick_reply', 10, new.conversation_id)
    on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists on_message_quick_reply on public.messages;
create trigger on_message_quick_reply
  after insert on public.messages
  for each row execute function public.award_quick_reply();

-- 6. Row Level Security — reads for signed-in users; writes only via server actions.
alter table public.connections  enable row level security;
alter table public.posts        enable row level security;
alter table public.post_likes   enable row level security;
alter table public.clubs        enable row level security;
alter table public.club_members enable row level security;
alter table public.point_events enable row level security;

create policy "read own connections" on public.connections
  for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));
create policy "read live posts" on public.posts
  for select to authenticated using (expires_at is null or expires_at > now());
create policy "read post likes" on public.post_likes
  for select to authenticated using (true);
create policy "read clubs" on public.clubs
  for select to authenticated using (true);
create policy "read club members" on public.club_members
  for select to authenticated using (true);
create policy "read own point events" on public.point_events
  for select to authenticated using (profile_id = (select auth.uid()));

-- 7. Load pgvector in this session first (see 3_match_profiles), then the two
--    vector helpers. Both are for server-side code only.
select '[0]'::extensions.vector;

-- Similarity between two people (cosine, 0..1). Null if either has no embedding.
create or replace function public.profile_similarity(p_a uuid, p_b uuid)
returns float
language sql stable
set search_path = public, extensions
as $$
  select 1 - (a.embedding <=> b.embedding)
  from profile_embeddings a, profile_embeddings b
  where a.profile_id = p_a and b.profile_id = p_b
    and a.embedding is not null and b.embedding is not null;
$$;
revoke execute on function public.profile_similarity(uuid, uuid) from public, anon, authenticated;

-- Free-text search: nearest profiles to a query embedding (uses the HNSW index).
create or replace function public.search_profiles_by_vector(
  p_query    extensions.vector(768),
  p_user_id  uuid,
  p_scope    text default 'global',
  p_limit    int  default 30
)
returns table (profile_id uuid, similarity float)
language sql stable
set search_path = public, extensions
set hnsw.iterative_scan = relaxed_order
as $$
  with nearest as materialized (
    select e.profile_id, e.embedding <=> p_query as distance
    from profile_embeddings e
    join profiles p on p.id = e.profile_id
    where e.profile_id <> p_user_id
      and e.embedding is not null
      and (p_scope = 'global'
           or p.college_id = (select college_id from profiles where id = p_user_id))
    order by e.embedding <=> p_query
    limit p_limit
  )
  select profile_id, 1 - distance as similarity
  from nearest
  order by distance + 0;
$$;
revoke execute on function public.search_profiles_by_vector(extensions.vector, uuid, text, int) from public, anon, authenticated;

-- =====================================================================
-- 8. API tokens for the MCP endpoint (prisma/migrations/6_api_tokens)
-- =====================================================================
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    -- first characters of the token, so people can tell their tokens apart
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_tokens_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60)
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_profile_id_idx" ON "api_tokens"("profile_id");
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

alter table public.api_tokens enable row level security;
