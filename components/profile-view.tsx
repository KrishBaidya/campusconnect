"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProfileViewData = {
    name: string;
    email: string;
    avatar?: string | null;
    headline?: string | null;
    bio?: string | null;
    role?: "student" | "alumni" | null;
    college?: string | null;
    batchYear?: number | null;
    interests: string[];
    expertise: string[];
    intents: string[];
    projects: { name: string; description: string; url: string | null; tech: string[] }[];
    experiences: { company: string; jobRole: string | null; start: string | null; end: string | null }[];
    githubUrl?: string | null;
    linkedinUrl?: string | null;
};

const sections = [
    { id: "profile", label: "Profile" },
    { id: "interest", label: "Interest" },
    { id: "projects", label: "Projects" },
    { id: "experience", label: "Experience" },
    { id: "contact", label: "Contact" },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function ProfileView({ user }: { user: ProfileViewData }) {
    const [active, setActive] = useState<SectionId>("profile");

    // Scroll-spy: mark the section crossing the middle of the viewport as active
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) setActive(entry.target.id as SectionId);
                });
            },
            { rootMargin: "-50% 0px -50% 0px" }
        );

        sections.forEach((s) => {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, []);

    const scrollTo = (id: SectionId) => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    };

    return (
        <main className="bg-background">
            {/* Mobile nav (sticky) */}
            <nav className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b bg-background/80 p-3 backdrop-blur md:hidden ">
                {sections.map((s) => (
                    <Button
                        key={s.id}
                        size="sm"
                        variant={active === s.id ? "default" : "ghost"}
                        onClick={() => scrollTo(s.id)}
                    >
                        {s.label}
                    </Button>
                ))}
            </nav>

            {/* Scrollable sections */}
            <div className="px-6 sm:px-12 md:pr-64">
                {sections.map((s) => (
                    <section
                        key={s.id}
                        id={s.id}
                        className="flex min-h-dvh scroll-mt-16 items-center py-16 md:scroll-mt-0"
                    >
                        <div className="w-full max-w-2xl">
                            <SectionContent id={s.id} user={user} />
                        </div>
                    </section>
                ))}
            </div>

            {/* Right-edge nav (desktop, fixed while scrolling) */}
            <nav
                aria-label="Sections"
                className="fixed right-0 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-end gap-5 md:flex"
            >
                {sections.map((s) => {
                    const isActive = active === s.id;
                    return (
                        <button
                            key={s.id}
                            onClick={() => scrollTo(s.id)}
                            aria-current={isActive ? "true" : undefined}
                            className="group flex items-center gap-3 outline-none"
                        >
                            <span
                                className={cn(
                                    "text-xl tracking-tight transition-all duration-300",
                                    isActive
                                        ? "font-semibold text-foreground"
                                        : "text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground"
                                )}
                            >
                                {s.label}
                            </span>
                            <span
                                className={cn(
                                    "h-px transition-all duration-300",
                                    isActive
                                        ? "w-28 bg-foreground"
                                        : "w-16 bg-muted-foreground group-hover:w-24 group-hover:bg-foreground"
                                )}
                            />
                        </button>
                    );
                })}
            </nav>
        </main>
    );
}

function SectionContent({ id, user }: { id: SectionId; user: ProfileViewData }) {
    switch (id) {
        case "profile":
            return (
                <div className="space-y-6">
                    <Avatar className="size-20">
                        <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
                        <AvatarFallback>
                            {user.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                        </AvatarFallback>
                    </Avatar>
                    <div className="space-y-3">
                        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                            {user.name}
                        </h1>
                        <p className="text-lg text-muted-foreground">
                            {user.headline ?? "A short line about who you are and what you do."}
                        </p>
                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                            {user.role && <Badge variant="secondary">{user.role === "alumni" ? "Alumni" : "Student"}</Badge>}
                            {user.college && <span>{user.college}{user.batchYear ? ` · ’${String(user.batchYear).slice(-2)}` : ""}</span>}
                        </div>
                        {user.bio && <p className="max-w-xl leading-relaxed">{user.bio}</p>}
                    </div>
                </div>
            );

        case "interest":
            return (
                <div className="space-y-8">
                    <div className="space-y-4">
                        <h2 className="text-4xl font-bold tracking-tight">Interests</h2>
                        <TagList tags={user.interests} empty="No interests yet." />
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-xl font-semibold tracking-tight">Can help with</h3>
                        <TagList tags={user.expertise} empty="No skills yet." />
                    </div>
                    {user.intents.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-xl font-semibold tracking-tight">Looking for</h3>
                            <TagList tags={user.intents} empty="" />
                        </div>
                    )}
                </div>
            );

        case "projects":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Projects</h2>
                    {user.projects.length === 0 && <p className="text-muted-foreground">No projects yet.</p>}
                    <ul className="space-y-4">
                        {user.projects.map((p) => (
                            <li key={p.name} className="border-b pb-4">
                                <p className="font-medium">
                                    {p.url ? (
                                        <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                                            {p.name}
                                        </a>
                                    ) : (
                                        p.name
                                    )}
                                </p>
                                <p className="text-sm text-muted-foreground">{p.description}</p>
                                {p.tech.length > 0 && (
                                    <p className="mt-1 font-mono text-xs text-muted-foreground">{p.tech.join(" · ")}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            );

        case "experience":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Experience</h2>
                    {user.experiences.length === 0 && <p className="text-muted-foreground">No experience added yet.</p>}
                    {user.experiences.map((e, i) => (
                        <div key={`${e.company}-${i}`} className="space-y-1">
                            <p className="font-medium">{[e.jobRole, e.company].filter(Boolean).join(" — ")}</p>
                            {(e.start || e.end) && (
                                <p className="text-sm text-muted-foreground">
                                    {e.start ?? "?"} – {e.end ?? "Present"}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            );

        case "contact":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Contact</h2>
                    <div className="flex flex-wrap gap-3">
                        <Button render={<a href={`mailto:${user.email}`} />}>Email</Button>
                        {user.linkedinUrl && (
                            <Button variant="outline" render={<a href={user.linkedinUrl} target="_blank" rel="noreferrer" />}>
                                LinkedIn
                            </Button>
                        )}
                        {user.githubUrl && (
                            <Button variant="outline" render={<a href={user.githubUrl} target="_blank" rel="noreferrer" />}>
                                GitHub
                            </Button>
                        )}
                    </div>
                </div>
            );
    }
}

function TagList({ tags, empty }: { tags: string[]; empty: string }) {
    if (tags.length === 0) return empty ? <p className="text-muted-foreground">{empty}</p> : null;
    return (
        <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="px-3 py-1 text-sm">
                    {tag}
                </Badge>
            ))}
        </div>
    );
}
