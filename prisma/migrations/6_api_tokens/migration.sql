-- =====================================================================
-- API tokens — personal access tokens for the MCP endpoint (/api/mcp).
-- Only a SHA-256 hash of each token is stored; the token itself is shown
-- once when created. Server-only: RLS is on with no policies, so the
-- Supabase API roles can't read or write this table at all.
-- Matches the ApiToken model.
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
