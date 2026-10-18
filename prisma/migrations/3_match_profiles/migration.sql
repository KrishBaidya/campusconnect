-- =====================================================================
-- match_profiles() — rewritten so pgvector's HNSW index is actually used.
--
-- The old version took the query vector from a JOIN, so Postgres could not
-- use profile_embeddings_hnsw and scanned every embedding. Here the query
-- vector is a scalar subquery (evaluated once), which the index accepts.
-- hnsw.iterative_scan keeps scanning the index when the college filter
-- removes candidates, so 'college' scope still returns up to p_limit rows.
-- =====================================================================

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
