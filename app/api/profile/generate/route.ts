import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { fetchGitHubSummary, type GitHubSummary } from "@/lib/github";
import { embed, embeddingSource, generateProfile } from "@/lib/ai/gemini";
import { githubUsernameOf } from "@/lib/profile/github-identity";
import { award } from "@/lib/points";

export const maxDuration = 60; // Gemini can take 10-30s with a PDF

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const INTENTS = ["mentor", "mentee", "referral", "cofounder", "investor", "internship", "collaborate"] as const;

const Form = z.object({
  role: z.enum(["student", "alumni"]),
  college: z.string().trim().min(2).max(120),
  batchYear: z.coerce.number().int().min(1950).max(2040).optional(),
  department: z.string().trim().max(120).optional(),
  intents: z.array(z.enum(INTENTS)).max(INTENTS.length),
  availability: z.enum(["weekdays", "weekends", "evenings", "flexible", "none"]).optional(),
  linkedinUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(u), "Must be a linkedin.com link")
    .optional(),
});

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return fail(401, "Not signed in");

  // ---------- 1. read + validate the form ----------
  const fd = await request.formData();
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  const parsed = Form.safeParse({
    role: str("role"),
    college: str("college"),
    batchYear: str("batchYear"),
    department: str("department"),
    intents: fd.getAll("intents").filter((v): v is string => typeof v === "string"),
    availability: str("availability"),
    linkedinUrl: str("linkedinUrl"),
  });
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid form");
  const form = parsed.data;

  let linkedinPdf: { data: Buffer; name: string } | null = null;
  const file = fd.get("linkedinPdf");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PDF_BYTES) return fail(400, "LinkedIn PDF must be under 5 MB");
    const data = Buffer.from(await file.arrayBuffer());
    if (data.subarray(0, 5).toString() !== "%PDF-") return fail(400, "That file isn’t a PDF");
    linkedinPdf = { data, name: file.name };
  }

  // ---------- 2. GitHub (only if the user linked it) ----------
  const githubUsername = githubUsernameOf(user);
  let github: GitHubSummary | null = null;
  if (githubUsername) {
    try {
      github = await fetchGitHubSummary(githubUsername);
    } catch (e) {
      console.warn("GitHub fetch failed:", e);
    }
  }
  if (!github && !linkedinPdf) return fail(400, "Connect GitHub or upload your LinkedIn PDF first");

  // ---------- 3. Gemini writes the profile ----------
  const googleName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? null) as string | null;
  let gen;
  try {
    gen = await generateProfile({
      role: form.role,
      college: form.college,
      batchYear: form.batchYear ?? null,
      department: form.department ?? null,
      intents: form.intents,
      googleName,
      github,
      linkedinPdf,
    });
  } catch (e) {
    console.error("Gemini profile generation failed:", e);
    return fail(502, "Couldn’t generate your profile — please try again");
  }

  // ---------- 4. save (one transaction) ----------
  const toDate = (ym: string | null) => (ym ? new Date(`${ym}-01T00:00:00Z`) : null);
  const college = await prisma.college.upsert({
    where: { name: form.college },
    update: {},
    create: { name: form.college },
  });

  const profileData = {
    role: form.role,
    collegeId: college.id,
    batchYear: form.batchYear ?? null,
    department: form.department ?? gen.department,
    firstName: gen.firstName ?? (googleName?.split(" ")[0] || null),
    lastName: gen.lastName ?? (googleName?.split(" ").slice(1).join(" ") || null),
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? github?.avatarUrl ?? null,
    headline: gen.headline,
    bio: gen.bio,
    interests: gen.interests,
    expertise: gen.expertise,
    intents: form.intents,
    availability: form.availability ? { preference: form.availability } : undefined,
    achievements: gen.achievements,
    projects: gen.projects,
    githubUsername: github?.username ?? githubUsername,
    githubUrl: github?.profileUrl ?? null,
    linkedinUrl: form.linkedinUrl ?? null,
    onboardedAt: new Date(),
  };

  await prisma.$transaction([
    prisma.profile.upsert({ where: { id: user.id }, update: profileData, create: { id: user.id, ...profileData } }),
    prisma.experience.deleteMany({ where: { profileId: user.id } }),
    prisma.experience.createMany({
      data: gen.experiences.map((e) => ({
        profileId: user.id,
        company: e.company,
        jobRole: e.jobRole,
        startDate: toDate(e.startDate),
        endDate: toDate(e.endDate),
      })),
    }),
  ]);

  // first finished profile earns points (no-op on re-runs)
  await award(prisma, user.id, "profile_complete", user.id).catch((e) => console.error("Awarding points failed:", e));

  // ---------- 5. embedding → pgvector ----------
  const source = embeddingSource({
    role: form.role,
    college: form.college,
    batchYear: form.batchYear ?? null,
    department: profileData.department,
    headline: gen.headline,
    bio: gen.bio,
    interests: gen.interests,
    expertise: gen.expertise,
    intents: form.intents,
    experiences: gen.experiences,
    projects: gen.projects,
  });
  let embedded = true;
  try {
    const vector = await embed(source);
    const literal = `[${vector.join(",")}]`;
    await prisma.$executeRaw`
      insert into profile_embeddings (profile_id, embedding, source, updated_at)
      values (${user.id}::uuid, ${literal}::extensions.vector, ${source}, now())
      on conflict (profile_id) do update
      set embedding = excluded.embedding, source = excluded.source, updated_at = now()`;
  } catch (e) {
    // the profile is saved either way; matching just won't include them until re-embedded
    console.error("Embedding failed:", e);
    embedded = false;
    // Don't keep matching on the previous profile's vector: clear it and store the new
    // source text, so a re-embed job can pick up rows where embedding is null.
    try {
      await prisma.$executeRaw`
        insert into profile_embeddings (profile_id, embedding, source, updated_at)
        values (${user.id}::uuid, null, ${source}, now())
        on conflict (profile_id) do update
        set embedding = null, source = excluded.source, updated_at = now()`;
    } catch (clearError) {
      console.error("Clearing stale embedding failed:", clearError);
    }
  }

  return NextResponse.json({ ok: true, embedded });
}
