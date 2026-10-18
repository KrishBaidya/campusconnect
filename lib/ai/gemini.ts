import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { GitHubSummary } from "@/lib/github";

let client: GoogleGenAI | null = null;
function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

/** Override in .env if Google renames models. */
const TEXT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
export const EMBED_DIMS = 768; // must match vector(768) in the database

/* ----------------------------- profile generation ----------------------------- */

const yyyymm = z.string().regex(/^\d{4}-\d{2}$/).nullable();

export const GeneratedProfile = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  headline: z.string().max(140),
  bio: z.string().max(700),
  department: z.string().nullable(),
  interests: z.array(z.string()).max(12),
  expertise: z.array(z.string()).max(15),
  experiences: z
    .array(z.object({ company: z.string(), jobRole: z.string().nullable(), startDate: yyyymm, endDate: yyyymm }))
    .max(15),
  projects: z
    .array(z.object({ name: z.string(), description: z.string(), url: z.string().nullable(), tech: z.array(z.string()) }))
    .max(8),
  achievements: z.array(z.object({ title: z.string(), detail: z.string().nullable() })).max(10),
});
export type GeneratedProfile = z.infer<typeof GeneratedProfile>;

const nullableStr = { type: Type.STRING, nullable: true };
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    firstName: nullableStr,
    lastName: nullableStr,
    headline: { type: Type.STRING, description: "One line, max 120 chars, e.g. 'Full-stack developer · BIMTECH ’27 · building with Next.js'" },
    bio: { type: Type.STRING, description: "2-4 sentences, first person, max 600 chars" },
    department: nullableStr,
    interests: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Topics they care about, short lowercase tags" },
    expertise: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Concrete skills they can offer, short tags" },
    experiences: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          company: { type: Type.STRING },
          jobRole: nullableStr,
          startDate: { type: Type.STRING, nullable: true, description: "YYYY-MM" },
          endDate: { type: Type.STRING, nullable: true, description: "YYYY-MM, null if current" },
        },
        required: ["company", "jobRole", "startDate", "endDate"],
      },
    },
    projects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          url: nullableStr,
          tech: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["name", "description", "url", "tech"],
      },
    },
    achievements: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, detail: nullableStr }, required: ["title", "detail"] },
    },
  },
  required: ["firstName", "lastName", "headline", "bio", "department", "interests", "expertise", "experiences", "projects", "achievements"],
};

export type ProfileSources = {
  role: "student" | "alumni";
  college: string;
  batchYear: number | null;
  department: string | null;
  intents: string[];
  googleName: string | null;
  github: GitHubSummary | null;
  linkedinPdf: { data: Buffer; name: string } | null;
};

const SYSTEM = `You build a member profile for CampusConnect, a network that matches students and alumni by intent.
Rules:
- Use ONLY facts present in the sources (GitHub JSON, LinkedIn PDF, form answers). Never invent employers, dates, numbers or awards.
- If a field has no evidence, return null or an empty list.
- Experiences come from the LinkedIn PDF (company, title, dates as YYYY-MM; endDate null if current).
- Projects: pick the most meaningful GitHub repos (and LinkedIn projects), max 6, with a one-sentence plain-English description.
- interests = what they care about; expertise = what they can offer others. Short tags, no duplicates.
- headline and bio should be specific and natural, not salesy. Write the bio in first person.`;

/** Turns GitHub data + LinkedIn PDF + form answers into a structured profile. */
export async function generateProfile(src: ProfileSources): Promise<GeneratedProfile> {
  const facts = {
    role: src.role,
    college: src.college,
    batchYear: src.batchYear,
    department: src.department,
    intents: src.intents,
    nameFromGoogle: src.googleName,
    github: src.github,
  };

  const parts: any[] = [{ text: `Sources (JSON):\n${JSON.stringify(facts, null, 2)}` }];
  if (src.linkedinPdf) {
    parts.push({ text: "LinkedIn profile export (PDF):" });
    parts.push({ inlineData: { mimeType: "application/pdf", data: src.linkedinPdf.data.toString("base64") } });
  } else {
    parts.push({ text: "No LinkedIn PDF was provided — leave experiences empty unless GitHub shows them." });
  }

  const res = await gemini().models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.3,
    },
  });

  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  const parsed = GeneratedProfile.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("Gemini returned an unexpected profile shape");

  // drop bad dates instead of failing the whole profile
  parsed.data.experiences = parsed.data.experiences.map((e) => ({
    ...e,
    startDate: e.startDate && /^\d{4}-\d{2}$/.test(e.startDate) ? e.startDate : null,
    endDate: e.endDate && /^\d{4}-\d{2}$/.test(e.endDate) ? e.endDate : null,
  }));
  return parsed.data;
}

/* --------------------------------- embeddings --------------------------------- */

/** The text that represents a person for matching. Saved alongside the vector so it can be re-embedded later. */
export function embeddingSource(p: {
  role: string | null;
  college: string | null;
  batchYear: number | null;
  department: string | null;
  headline: string | null;
  bio: string | null;
  interests: string[];
  expertise: string[];
  intents: string[];
  experiences: { company: string; jobRole: string | null }[];
  projects: { name: string; tech: string[] }[];
}) {
  return [
    `Role: ${p.role ?? "unknown"}${p.college ? ` at ${p.college}` : ""}${p.batchYear ? `, batch ${p.batchYear}` : ""}`,
    p.department && `Department: ${p.department}`,
    p.headline && `Headline: ${p.headline}`,
    p.bio && `About: ${p.bio}`,
    p.expertise.length && `Can offer: ${p.expertise.join(", ")}`,
    p.interests.length && `Interested in: ${p.interests.join(", ")}`,
    p.intents.length && `Looking for: ${p.intents.join(", ")}`,
    p.experiences.length && `Experience: ${p.experiences.map((e) => [e.jobRole, e.company].filter(Boolean).join(" at ")).join("; ")}`,
    p.projects.length && `Projects: ${p.projects.map((x) => `${x.name} (${x.tech.join(", ")})`).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 768-number embedding, L2-normalised (Google recommends normalising when using fewer than 3072 dims). */
export async function embed(text: string): Promise<number[]> {
  const res = await gemini().models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { outputDimensionality: EMBED_DIMS, taskType: "SEMANTIC_SIMILARITY" },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values || values.length !== EMBED_DIMS) throw new Error(`Expected a ${EMBED_DIMS}-dim embedding from Gemini`);
  const norm = Math.hypot(...values) || 1;
  return values.map((v) => v / norm);
}

/* ------------------------------ connect messages ------------------------------ */

export type NoteProfile = {
  name: string;
  role: string | null;
  college: string | null;
  headline: string | null;
  interests: string[];
  expertise: string[];
  intents: string[];
  experiences: { company: string; jobRole: string | null }[];
};

const NOTE_SYSTEM = `You write the short note a member of CampusConnect sends with a connection request.
Rules:
- 2 or 3 sentences, under 300 characters, first person, from the sender to the recipient.
- Mention one specific thing they share or that the sender wants to learn from the recipient, using only the facts given.
- Friendly and direct. No flattery, no emojis, no hashtags, no sign-off, no placeholders like [Name].
- Address the recipient by first name.`;

/** Drafts a personalised connect note from the sender to the recipient. The sender can edit it before sending. */
export async function draftConnectNote(from: NoteProfile, to: NoteProfile, context?: string): Promise<string> {
  const res = await gemini().models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `Sender:\n${JSON.stringify(from)}\n\nRecipient:\n${JSON.stringify(to)}${context ? `\n\nThe sender found them through: ${context}` : ""}` }],
      },
    ],
    config: { systemInstruction: NOTE_SYSTEM, temperature: 0.7, maxOutputTokens: 200 },
  });
  const text = res.text?.trim().replace(/^"|"$/g, "");
  if (!text) throw new Error("Gemini returned an empty note");
  return text.slice(0, 600);
}
