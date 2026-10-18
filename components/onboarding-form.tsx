"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConnectionHub, type ProviderId } from "@/components/connection_hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const INTENTS = [
  { id: "mentor", label: "Find a mentor" },
  { id: "mentee", label: "Mentor someone" },
  { id: "referral", label: "Job referrals" },
  { id: "internship", label: "Internships" },
  { id: "cofounder", label: "Co-founder" },
  { id: "investor", label: "Investors" },
  { id: "collaborate", label: "Collaborate on projects" },
] as const;

const AVAILABILITY = [
  { id: "weekdays", label: "Weekdays" },
  { id: "evenings", label: "Evenings" },
  { id: "weekends", label: "Weekends" },
  { id: "flexible", label: "Flexible" },
  { id: "none", label: "Not right now" },
] as const;

type Role = "student" | "alumni";
type Fields = {
  role: Role | null;
  college: string;
  batchYear: string;
  department: string;
  intents: string[];
  availability: string;
  linkedinUrl: string;
};

const DRAFT_KEY = "cc-onboarding-draft";
const STEPS = ["Reading your GitHub…", "Reading your LinkedIn PDF…", "Gemini is writing your profile…", "Creating your match embedding…"];

export function OnboardingForm({
  githubUsername,
  initials,
  colleges,
  defaults,
}: {
  githubUsername: string | null;
  initials: string;
  colleges: string[];
  defaults: Omit<Fields, "availability"> & { role: Role | null };
}) {
  const router = useRouter();
  const [f, setF] = React.useState<Fields>({ ...defaults, availability: "flexible" });
  const [pdf, setPdf] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const pickResolver = React.useRef<((f: File | null) => void) | null>(null);

  // Linking GitHub leaves the page — keep the typed answers across that round-trip.
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved) setF((cur) => ({ ...cur, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    } catch {}
  }, [f]);

  // the file picker's "cancel" event isn't in React's types — listen for it directly
  React.useEffect(() => {
    const el = fileInput.current;
    if (!el) return;
    const onCancel = () => {
      pickResolver.current?.(null);
      pickResolver.current = null;
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const toggleIntent = (id: string) =>
    set("intents", f.intents.includes(id) ? f.intents.filter((x) => x !== id) : [...f.intents, id]);

  /* ---------------- connection hub handlers ---------------- */

  function pickPdf(): Promise<File | null> {
    return new Promise((resolve) => {
      pickResolver.current = resolve;
      fileInput.current?.click();
    });
  }

  async function onConnect(id: ProviderId) {
    if (id === "github") {
      if (githubUsername) return { summary: `@${githubUsername}` };
      const supabase = createClient();
      const { error } = await supabase.auth.linkIdentity({
        provider: "github",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      if (error) throw new Error(error.message.includes("manual linking") ? "Enable manual linking in Supabase" : error.message);
      // the browser is now on its way to GitHub
      await new Promise(() => {});
    }
    const file = await pickPdf();
    if (!file) throw new Error("No PDF chosen");
    if (file.type !== "application/pdf") throw new Error("Choose a PDF file");
    if (file.size > 5 * 1024 * 1024) throw new Error("PDF must be under 5 MB");
    setPdf(file);
    return { summary: file.name.length > 22 ? file.name.slice(0, 20) + "…" : file.name };
  }

  async function onDisconnect(id: ProviderId) {
    if (id === "linkedin") return setPdf(null);
    const supabase = createClient();
    const { data } = await supabase.auth.getUserIdentities();
    const gh = data?.identities.find((i) => i.provider === "github");
    if (gh) {
      const { error } = await supabase.auth.unlinkIdentity(gh);
      if (error) setError(error.message);
    }
    router.refresh();
  }

  /* ---------------- submit ---------------- */

  const canSubmit = f.role && f.college.trim().length >= 2 && (githubUsername || pdf) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setStep(0);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);

    const body = new FormData();
    body.set("role", f.role!);
    body.set("college", f.college.trim());
    if (f.batchYear) body.set("batchYear", f.batchYear);
    if (f.department.trim()) body.set("department", f.department.trim());
    f.intents.forEach((i) => body.append("intents", i));
    body.set("availability", f.availability);
    if (f.linkedinUrl.trim()) body.set("linkedinUrl", f.linkedinUrl.trim());
    if (pdf) body.set("linkedinPdf", pdf);

    try {
      const res = await fetch("/api/profile/generate", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      sessionStorage.removeItem(DRAFT_KEY);
      router.push("/profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    } finally {
      clearInterval(ticker);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-12">
      {/* 1. Sources */}
      <section className="space-y-4">
        <StepTitle n={1} title="Connect your sources" />
        <div className="rounded-2xl bg-zinc-950 p-4 sm:p-6">
          <ConnectionHub
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            initial={githubUsername ? { github: { since: Date.now(), summary: `@${githubUsername}` } } : undefined}
            hubContent={<span className="text-lg font-bold sm:text-2xl">{initials}</span>}
          />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            pickResolver.current?.(e.target.files?.[0] ?? null);
            pickResolver.current = null;
            e.target.value = "";
          }}
        />
        <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
          <p>
            <span className="font-medium text-foreground">GitHub:</span> tap the GitHub node to link your account. We read your
            public profile and repos.
          </p>
          <p>
            <span className="font-medium text-foreground">LinkedIn:</span> open your LinkedIn profile → <b>Resources</b> (or{" "}
            <b>More</b>) → <b>Save to PDF</b>, then tap the LinkedIn node and choose that file. LinkedIn doesn’t share your
            experience with apps directly.
          </p>
        </div>
        <div className="grid gap-2 sm:max-w-md">
          <Label htmlFor="linkedinUrl">LinkedIn profile link (optional)</Label>
          <Input
            id="linkedinUrl"
            type="url"
            placeholder="https://www.linkedin.com/in/your-name"
            value={f.linkedinUrl}
            onChange={(e) => set("linkedinUrl", e.target.value)}
          />
        </div>
      </section>

      {/* 2. About you */}
      <section className="space-y-5">
        <StepTitle n={2} title="About you" />
        <div className="flex gap-2">
          {(["student", "alumni"] as const).map((r) => (
            <Button
              key={r}
              type="button"
              variant={f.role === r ? "default" : "outline"}
              onClick={() => set("role", r)}
              aria-pressed={f.role === r}
            >
              {r === "student" ? "I’m a student" : "I’m an alumnus"}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2 sm:col-span-3">
            <Label htmlFor="college">College</Label>
            <Input
              id="college"
              list="college-list"
              required
              placeholder="e.g. BIMTECH"
              value={f.college}
              onChange={(e) => set("college", e.target.value)}
            />
            <datalist id="college-list">
              {colleges.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batchYear">{f.role === "alumni" ? "Graduation year" : "Batch (passing year)"}</Label>
            <Input
              id="batchYear"
              inputMode="numeric"
              placeholder="2027"
              value={f.batchYear}
              onChange={(e) => set("batchYear", e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="department">Department / programme (optional)</Label>
            <Input
              id="department"
              placeholder="PGDM Marketing"
              value={f.department}
              onChange={(e) => set("department", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* 3. Intent */}
      <section className="space-y-5">
        <StepTitle n={3} title="What are you here for?" />
        <div className="flex flex-wrap gap-2">
          {INTENTS.map((i) => {
            const on = f.intents.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggleIntent(i.id)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {i.label}
              </button>
            );
          })}
        </div>
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="availability">Available to connect</Label>
          <select
            id="availability"
            value={f.availability}
            onChange={(e) => set("availability", e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {AVAILABILITY.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Submit */}
      <div className="space-y-3 border-t pt-6">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!busy && !canSubmit && (
          <p className="text-sm text-muted-foreground">
            {!githubUsername && !pdf ? "Connect GitHub or add your LinkedIn PDF, " : ""}
            {!f.role ? "pick student or alumnus, " : ""}
            {f.college.trim().length < 2 ? "add your college " : ""}to continue.
          </p>
        )}
        <Button type="submit" size="lg" disabled={!canSubmit} className="w-full sm:w-auto">
          {busy ? STEPS[step] : "Generate my profile"}
        </Button>
      </div>
    </form>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-full bg-primary text-sm text-primary-foreground">{n}</span>
      {title}
    </h2>
  );
}
