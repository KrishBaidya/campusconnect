-- =====================================================================
-- Network — connections (the "Connect" handshake), posts and stories,
-- clubs, and the point system. Writes go through server actions (Prisma);
-- the API roles get read access through RLS, plus one trigger that awards
-- points for quick replies in Messages.
-- Matches the Connection / Post / PostLike / Club / ClubMember / PointEvent models.
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
