-- =====================================================================
-- Messages — 1:1 direct messages between profiles, delivered live with
-- Supabase Realtime. Run in Supabase → SQL Editor if you don't use
-- `prisma migrate deploy`. Matches the Conversation / Message models.
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
