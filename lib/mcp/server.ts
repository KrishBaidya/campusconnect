import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { discoverPeople, fullName, getPerson, getViewer, similarityBetween, type PersonCard, type Viewer } from "@/lib/people";
import { aiSearch, cofounders, reverseMentors } from "@/lib/match";
import { getFeed, type FeedPost } from "@/lib/feed";
import { getMentorship, type MentorshipItem } from "@/lib/mentorship";
import { connectionStates, incomingRequests } from "@/lib/network";
import { leaderboard, rankOf } from "@/lib/points";
import { draftNote, respondConnection, sendConnection } from "@/lib/connect";
import { createPostAs } from "@/lib/posting";
import { requestMentorshipAs } from "@/lib/mentorship-request";
import { fuzzyMatch } from "@/lib/fuzzy";

// The AluminX MCP server. One instance is built per request, bound to the
// person the API token belongs to: every tool acts as them and sees only
// what they could see in the app.

const VERSION = "1.0.0";

const scope = z.enum(["college", "global"]).default("college").describe("college = your own college only (falls back to global if you have none); global = every college");
const limit = z.number().int().min(1).max(50).default(15).describe("Maximum number of results");
const id = z.string().uuid();

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** Tool result as both readable text and structured JSON. */
function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** What an assistant needs about a person, without app-only fields. */
function person(p: PersonCard) {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    title: p.title,
    batch: p.batch,
    college: p.college,
    interests: p.interests,
    expertise: p.expertise,
    here_to: p.intents,
    companies: p.companies,
    clubs: p.clubs,
    points: p.points,
    similarity: p.similarity === null ? null : Math.round(p.similarity * 100) / 100,
    why: p.why,
    profile_url: `/profile/${p.id}`,
  };
}

function post(p: FeedPost) {
  return {
    id: p.id,
    kind: p.kind,
    body: p.body,
    link: p.linkUrl,
    company: p.company,
    created_at: p.createdAt,
    author: { id: p.author.id, name: p.author.name, line: p.author.line, open_to_mentoring: p.author.openToMentoring },
    appreciations: p.likes,
    appreciated_by_you: p.liked,
    yours: p.mine,
  };
}

function mentorship(m: MentorshipItem) {
  return {
    id: m.id,
    status: m.status,
    with: { id: m.other.id, name: m.other.name, title: m.other.title },
    message: m.message,
    proposed_times: m.slots,
    scheduled_at: m.scheduledAt,
    decline_reason: m.declineReason,
    created_at: m.createdAt,
  };
}

const effectiveScope = (viewer: Viewer, s: "college" | "global") => (s === "college" && !viewer.collegeId ? "global" : s);

export async function buildMcpServer(profileId: string) {
  const viewer = await getViewer(profileId);
  const server = new McpServer(
    { name: "aluminx", title: "AluminX", version: VERSION },
    {
      instructions: `AluminX is an intent-based network connecting students and alumni, first within a college and then globally.
You are acting as ${viewer.name}${viewer.college ? ` (${viewer.college})` : ""}. Use whoami first if you need their profile.
Find people with search_people (natural language), browse_people (filters), find_reverse_mentors and find_cofounders.
Before sending a connection request, draft a note with draft_connect_note and show it to the user; only send after they agree.
Times are ISO 8601 with a timezone offset.`,
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "The signed-in member's own profile, points, rank and what's waiting for them (unread messages, connection and mentorship requests).",
      annotations: READ,
    },
    async () => {
      const [me, rank] = await Promise.all([getPerson(viewer.id, viewer), rankOf(viewer.points, viewer.collegeId)]);
      if (!me) return err("Your profile isn't finished yet. Complete onboarding in the app first.");
      return ok({
        ...person(me),
        bio: me.bio,
        department: me.department,
        connections: me.connections,
        rank_at_college: rank,
        waiting: {
          unread_messages: viewer.counts.unreadMessages,
          connection_requests: viewer.counts.pendingConnections,
          mentorship_requests: viewer.counts.pendingMentorship,
        },
      });
    },
  );

  server.registerTool(
    "search_people",
    {
      title: "Search people (AI)",
      description:
        "Find people by meaning, not keywords, e.g. 'alumni who moved from sales into fintech product'. Uses Gemini embeddings over every profile. Results include a similarity score from 0 to 1.",
      inputSchema: { query: z.string().min(3).max(300).describe("Who you're looking for, in plain words"), scope, limit },
      annotations: READ,
    },
    async ({ query, scope: s, limit: n }) => {
      const res = await aiSearch(viewer, effectiveScope(viewer, s), query);
      if (!res.ok) return err(res.error);
      return ok({ count: Math.min(n, res.people.length), people: res.people.slice(0, n).map(person) });
    },
  );

  server.registerTool(
    "browse_people",
    {
      title: "Browse people",
      description:
        "List members with filters, ranked by how close they are to you. Text matching is typo-tolerant and covers names, companies, clubs and skills. Use this for hobbies, jobs and placements, mentors, clubs and company tags.",
      inputSchema: {
        scope,
        role: z.enum(["student", "alumni"]).optional(),
        here_to: z
          .enum(["mentor", "mentee", "referral", "cofounder", "investor", "internship", "collaborate"])
          .optional()
          .describe("What they're on AluminX for, e.g. mentor = open to mentoring, referral = gives job referrals"),
        company: z.string().max(80).optional().describe("Worked at this company (company tag)"),
        club: z.string().max(60).optional(),
        interest: z.string().max(60).optional().describe("A hobby or interest"),
        text: z.string().max(100).optional().describe("Free text, typo-tolerant"),
        limit,
      },
      annotations: READ,
    },
    async ({ scope: s, role, here_to, company, club, interest, text, limit: n }) => {
      const all = await discoverPeople(viewer, effectiveScope(viewer, s));
      const has = (xs: string[], v?: string) => !v || xs.some((x) => fuzzyMatch(v, x.toLowerCase()));
      const people = all.filter(
        (p) =>
          (!role || p.role === role) &&
          (!here_to || p.intents.includes(here_to)) &&
          has(p.companies, company) &&
          has(p.clubs, club) &&
          has([...p.interests, ...p.expertise], interest) &&
          (!text || fuzzyMatch(text, p.keywords)),
      );
      return ok({ total: people.length, people: people.slice(0, n).map(person) });
    },
  );

  server.registerTool(
    "find_reverse_mentors",
    {
      title: "Find reverse mentors",
      description: "People, often juniors, whose skills cover things the member is interested in but doesn't list as their own skills. Good for learning new tools from students.",
      inputSchema: { scope, limit },
      annotations: READ,
    },
    async ({ scope: s, limit: n }) => {
      const people = await reverseMentors(viewer, effectiveScope(viewer, s));
      return ok({ count: Math.min(n, people.length), people: people.slice(0, n).map(person) });
    },
  );

  server.registerTool(
    "find_cofounders",
    {
      title: "Find co-founders",
      description: "People looking for a co-founder whose skills complement the member's (skills they don't list) and who share their interests.",
      inputSchema: { scope, limit },
      annotations: READ,
    },
    async ({ scope: s, limit: n }) => {
      const people = await cofounders(viewer, effectiveScope(viewer, s));
      return ok({ count: Math.min(n, people.length), people: people.slice(0, n).map(person) });
    },
  );

  server.registerTool(
    "get_profile",
    {
      title: "Get a profile",
      description: "Full profile of one member: bio, experience, projects, clubs, what you share, your similarity and your connection status with them.",
      inputSchema: { person_id: id },
      annotations: READ,
    },
    async ({ person_id }) => {
      const [p, conn, sim] = await Promise.all([getPerson(person_id, viewer), connectionStates(viewer.id, [person_id]), similarityBetween(viewer.id, person_id)]);
      if (!p) return err("No member with that id, or they haven't finished their profile.");
      return ok({
        ...person({ ...p, similarity: sim }),
        bio: p.bio,
        headline: p.headline,
        department: p.department,
        availability: p.availability,
        experience: p.experiences,
        projects: p.projects,
        you_share: p.shared,
        connections: p.connections,
        linkedin: p.linkedinUrl,
        github: p.githubUrl,
        connection_with_you: person_id === viewer.id ? "self" : conn[person_id]?.status ?? "none",
      });
    },
  );

  server.registerTool(
    "get_feed",
    {
      title: "Read the feed",
      description: "Recent posts (updates, opportunities, referrals with company tags, projects) and live stories.",
      inputSchema: {
        scope: z.enum(["foryou", "college", "global"]).default("foryou").describe("foryou = your connections, college and closest matches"),
        kind: z.enum(["update", "opportunity", "referral", "project"]).optional(),
        limit,
      },
      annotations: READ,
    },
    async ({ scope: s, kind, limit: n }) => {
      const feed = await getFeed(viewer, s);
      const posts = feed.posts.filter((p) => !kind || p.kind === kind);
      return ok({
        posts: posts.slice(0, n).map(post),
        stories: feed.stories.map((g) => ({ author: g.author.name, author_id: g.author.id, items: g.posts.map((p) => ({ body: p.body, created_at: p.createdAt })) })),
      });
    },
  );

  server.registerTool(
    "get_mentorship",
    {
      title: "Mentorship overview",
      description: "Mentorship requests waiting on you, your mentees and mentors with session times, requests you sent, and your monthly capacity.",
      annotations: READ,
    },
    async () => {
      const m = await getMentorship(viewer.id);
      return ok({
        requests_to_you: m.incoming.map(mentorship),
        your_mentees: m.mentees.map(mentorship),
        your_mentors: m.mentors.map(mentorship),
        sent: m.sent.map(mentorship),
        capacity_per_month: m.capacity,
        booked_this_month: m.bookedThisMonth,
        open_blocks: m.openBlocks,
      });
    },
  );

  server.registerTool(
    "list_connection_requests",
    {
      title: "Connection requests",
      description: "Pending connection requests other members sent you, with their notes.",
      annotations: READ,
    },
    async () => {
      const rows = await incomingRequests(viewer.id, 25);
      return ok({
        requests: rows.map((c) => ({ request_id: c.id, from: { id: c.requester.id, name: fullName(c.requester), headline: c.requester.headline }, note: c.message, sent_at: c.createdAt.toISOString() })),
      });
    },
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Points leaderboard",
      description: "Top members by points. Points come from mentoring, replying quickly, connecting and posting.",
      inputSchema: { scope, limit: z.number().int().min(1).max(25).default(10) },
      annotations: READ,
    },
    async ({ scope: s, limit: n }) => {
      const college = effectiveScope(viewer, s) === "college" ? viewer.collegeId : null;
      const [top, rank] = await Promise.all([leaderboard(college, n), rankOf(viewer.points, college)]);
      return ok({ you: { points: viewer.points, rank }, top: top.map((p, i) => ({ rank: i + 1, id: p.id, name: fullName(p), points: p.points })) });
    },
  );

  server.registerTool(
    "draft_connect_note",
    {
      title: "Draft a connect note",
      description: "Writes a short, personal note for a connection request using both profiles (Gemini, with a template fallback). Nothing is sent. Show it to the user before calling send_connection_request.",
      inputSchema: { person_id: id, context: z.string().max(200).optional().describe("Where they found this person, e.g. 'their referral post for Swiggy'") },
      annotations: READ,
    },
    async ({ person_id, context }) => {
      const res = await draftNote(viewer.id, person_id, context);
      return res.ok ? ok({ note: res.note, written_by: res.ai ? "gemini" : "template" }) : err(res.error);
    },
  );

  server.registerTool(
    "send_connection_request",
    {
      title: "Send a connection request",
      description:
        "Sends a Connect request as the member. The note is also delivered to the recipient's Messages. If they already asked the member, this accepts their request instead. Confirm with the user before calling.",
      inputSchema: { person_id: id, note: z.string().max(600).optional() },
      annotations: WRITE,
    },
    async ({ person_id, note }) => {
      const res = await sendConnection(viewer.id, { targetId: person_id, message: note });
      if (!res.ok) return err(res.error);
      return ok({ status: res.accepted ? "connected (accepted their pending request)" : "request sent" });
    },
  );

  server.registerTool(
    "respond_to_connection_request",
    {
      title: "Accept or decline a connection request",
      description: "Answers a request from list_connection_requests. Accepting earns both people points.",
      inputSchema: { request_id: id, accept: z.boolean() },
      annotations: WRITE,
    },
    async ({ request_id, accept }) => {
      const res = await respondConnection(viewer.id, request_id, accept);
      return res.ok ? ok({ status: accept ? "accepted" : "declined" }) : err(res.error);
    },
  );

  server.registerTool(
    "request_mentorship",
    {
      title: "Request a mentorship session",
      description: "Asks a mentor (someone whose here_to includes 'mentor') for a session, suggesting 1 to 3 times within the next 60 days. Confirm the message and times with the user first.",
      inputSchema: {
        mentor_id: id,
        message: z.string().min(10).max(1000).describe("What the member wants help with"),
        times: z.array(z.string().datetime({ offset: true })).min(1).max(3).describe("ISO 8601 times with offset, e.g. 2026-10-29T18:30:00+05:30"),
      },
      annotations: WRITE,
    },
    async ({ mentor_id, message, times }) => {
      const res = await requestMentorshipAs(viewer.id, { mentorId: mentor_id, message, slots: times });
      return res.ok ? ok({ status: "request sent" }) : err(res.error);
    },
  );

  server.registerTool(
    "create_post",
    {
      title: "Post to the feed",
      description: "Publishes a post as the member. Referrals need a company. Stories are 280 characters max and disappear after 24 hours. Confirm the text with the user first.",
      inputSchema: {
        kind: z.enum(["update", "opportunity", "referral", "project", "story"]),
        body: z.string().min(1).max(2000),
        link_url: z.string().url().optional(),
        company: z.string().max(80).optional(),
      },
      annotations: WRITE,
    },
    async ({ kind, body, link_url, company }) => {
      const res = await createPostAs(viewer.id, { kind, body, linkUrl: link_url, company });
      return res.ok ? ok({ status: "posted", post_id: res.id }) : err(res.error);
    },
  );

  return server;
}
