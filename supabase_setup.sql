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
    "college_id" UUID,
    "department" TEXT,
    "batch_year" INTEGER,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" JSONB,
    "achievements" JSONB NOT NULL DEFAULT '[]',
    "github_url" TEXT,
    "linkedin_url" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,

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
create or replace function public.match_profiles(
  p_user_id uuid,
  p_scope   text default 'global',
  p_limit   int  default 10
)
returns table (profile_id uuid, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select e.profile_id,
         1 - (e.embedding <=> me.embedding) as similarity
  from profile_embeddings e
  join profiles p        on p.id = e.profile_id
  join profile_embeddings me on me.profile_id = p_user_id
  join profiles mine     on mine.id = p_user_id
  where e.profile_id <> p_user_id
    and e.embedding is not null
    and (p_scope = 'global' or p.college_id = mine.college_id)
  order by e.embedding <=> me.embedding
  limit p_limit;
$$;