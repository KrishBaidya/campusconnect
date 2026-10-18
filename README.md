# AluminX (CampusConnect)

An intent-based network that connects students with alumni, first inside their own college and then across universities. People are matched by what they want from the network (mentoring, referrals, co-founders, internships) and by what they know, not by follower count.

## Features

- **Profiles built for you.** Sign in with Google, connect GitHub and upload your LinkedIn PDF. Gemini drafts your headline, bio, interests, expertise, experience and projects.
- **Discover.**
  - Search your college or go global.
  - Filter by role, jobs and placements, hobbies, clubs and companies.
  - Search is typo-tolerant ("pyhton" finds Python).
  - Results are ranked by profile similarity (Gemini embeddings + pgvector).
- **Smart search modes.**
  - **Ask AI:** describe someone in plain words.
  - **Reverse mentors:** people, often juniors, whose skills cover things you want to learn.
  - **Co-founders:** people whose skills complement yours.
- **Connect.**
  - A handshake request (pending, then accepted) with a personal note that Gemini drafts. The note also lands in the other person's Messages.
- **Home feed.**
  - Posts of four types: update, opportunity, referral (with a company tag) and project.
  - Stories that disappear after 24 hours.
  - Appreciations (likes), a leaderboard and people you may know.
- **Messages.** 1:1 chat in real time over Supabase Realtime, with read receipts. The side panel shows interests you share and your mentorship sessions together.
- **Mentorship.**
  - Mentors set how many sessions they take each month and the weekly times they're usually free.
  - Mentees request a session and suggest up to three times. The mentor accepts one time or declines.
- **Points.** Earned for finishing your profile, connecting, replying within 48 hours, mentoring and posting. This gives alumni a reason to answer beginners.
- **Clubs.** Each college has its own clubs; join them from your profile and filter by them in Discover.
- **MCP server.** AI assistants like Claude can use AluminX for you. See [MCP server](#mcp-server).

## Tech stack

| Layer | Technology |
| --- | --- |
| App | Next.js 16 (App Router, Cache Components), React 19 |
| Database | Supabase Postgres, Prisma 7 (`@prisma/adapter-pg`) |
| Vectors | pgvector with an HNSW index (768-dim Gemini embeddings) |
| Auth, chat | Supabase Auth (Google, GitHub), Supabase Realtime |
| AI | Gemini (`@google/genai`): profile generation, embeddings, connect notes |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP |

Writes go through server actions using Prisma. The browser's Supabase client only reads, and Row Level Security limits it to rows the member may see. The exception is Messages: the browser client sends messages directly, still limited by RLS.

## Getting started

Requirements: Node 20+, pnpm 11, and a Supabase project with the `vector` extension enabled.

1. Install dependencies. This also generates the Prisma client.
   ```bash
   pnpm install
   ```
2. Copy `.env.example` to `.env` and fill it in. You'll need the database URLs, the Supabase URL and publishable key, and `GEMINI_API_KEY`. `GITHUB_TOKEN` is optional.
3. Apply the database migrations:
   ```bash
   pnpm prisma migrate deploy
   ```
   If you'd rather not use Prisma for migrations, run `supabase_setup.sql` once in the Supabase SQL editor instead.
4. Start the app:
   ```bash
   pnpm dev
   ```

After you pull changes that touch `prisma/schema.prisma`, run `pnpm prisma generate` and restart the dev server. The running server keeps the old Prisma client in memory.

### Migrations

| Migration | Adds |
| --- | --- |
| `0_init` | colleges, profiles, experiences, profile embeddings, RLS |
| `1_onboarding` | onboarding fields |
| `2_messages` | conversations, messages, `start_conversation()`, Realtime |
| `3_match_profiles` | `match_profiles()` using the HNSW index |
| `4_mentorship` | mentorship requests, mentor capacity and open blocks |
| `5_network` | connections, posts, likes, clubs, points ledger and triggers, vector search |
| `6_api_tokens` | personal access tokens for the MCP server |

## MCP server

AluminX runs a [Model Context Protocol](https://modelcontextprotocol.io) server at **`/api/mcp`**. It uses the Streamable HTTP transport and keeps no session between requests. An assistant connected to it acts as one member: it sees what that member can see and can do what they can do.

### 1. Create a token

Open your **Profile** and scroll to **Connect an AI assistant**. Name a token (for example "Claude Desktop") and click **Create token**.

The token starts with `alx_` and is shown only once. AluminX stores just a SHA-256 hash of it, and you can revoke it on the same page. Each member can have up to 5 active tokens. Anyone holding a token can act as you, so keep it private.

### 2. Add the server to your assistant

**Claude Code**

```bash
claude mcp add --transport http aluminx https://YOUR-APP/api/mcp --header "Authorization: Bearer alx_your_token"
```

**Claude Desktop**, or any client that only supports stdio, through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "aluminx": {
      "command": "npx",
      "args": ["mcp-remote", "https://YOUR-APP/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer alx_your_token" }
    }
  }
}
```

**MCP Inspector**, for testing:

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector, choose Streamable HTTP, enter `http://localhost:3000/api/mcp`, and add an `Authorization: Bearer alx_…` header.

### Tools

| Tool | What it does |
| --- | --- |
| `whoami` | Your profile, points, rank, and what's waiting for you |
| `search_people` | Natural-language people search (Gemini embeddings + pgvector) |
| `browse_people` | Filter by role, intent, company, club, interest or free text (typo-tolerant) |
| `find_reverse_mentors` | People whose skills cover what you want to learn |
| `find_cofounders` | Co-founder candidates with complementary skills |
| `get_profile` | One member's full profile, your similarity score and your connection status |
| `get_feed` | Recent posts and stories (For you, your college or Global) |
| `get_mentorship` | Requests to you, your mentors and mentees, sent requests, capacity |
| `list_connection_requests` | Pending Connect requests sent to you |
| `get_leaderboard` | Top members by points, and your rank |
| `draft_connect_note` | Drafts a personal note for a Connect request (sends nothing) |
| `send_connection_request` ✏️ | Sends a Connect request with a note |
| `respond_to_connection_request` ✏️ | Accepts or declines a request sent to you |
| `request_mentorship` ✏️ | Asks a mentor for a session at up to 3 suggested times |
| `create_post` ✏️ | Posts an update, opportunity, referral, project or story |

✏️ marks tools that change data. They're annotated as non-read-only so clients can ask for confirmation, and the server's instructions tell the assistant to confirm with you first.

### How it works

- `app/api/mcp/route.ts` reads the bearer token and looks up its owner (`lib/api-tokens.ts`). It then builds a fresh server for that member (`lib/mcp/server.ts`) and answers with plain JSON.
- The tools reuse the app's own logic. Reads come from `lib/people.ts`, `lib/match.ts`, `lib/feed.ts` and `lib/mentorship.ts`. Writes come from `lib/connect.ts`, `lib/posting.ts` and `lib/mentorship-request.ts`, the same functions the app's server actions call. So the app and the assistant follow the same rules and award the same points.
- `proxy.ts` skips `/api/mcp`, because the endpoint authenticates with tokens, not cookies.
- A missing or revoked token returns `401` with a `WWW-Authenticate: Bearer` header.

## Project layout

```text
app/                 routes: home feed, discover, profile, messages, mentorship, /api/mcp
  */actions.ts       server actions (session-authenticated wrappers)
components/aluminx/  UI and styles from the AluminX mockups (scoped under .ax)
components/messages/ the chat client
lib/                 data access, matching, points, Gemini, MCP server
prisma/              schema and SQL migrations
supabase_setup.sql   all migrations in one script, for the Supabase SQL editor
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Make a production build, then serve it |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:status` | Show which migrations are applied |
| `pnpm db:studio` | Open Prisma Studio |
