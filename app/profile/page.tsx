"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type User = {
    name: string;
    email: string;
    avatar?: string;
    location?: string;
    intrest?: string[];
    college?: string;
};

const user: User = {
    name: "John Doe",
    email: "john.doe@example.com",
    location: "New York, NY",
    avatar: "https://github.com/shadcn.png",
    intrest: ["Music", "Sports", "Travel"],
    college: "University of Example"
};

const sections = [
    { id: "profile", label: "Profile" },
    { id: "interest", label: "Interest" },
    { id: "projects", label: "Projects" },
    { id: "experience", label: "Experience" },
    { id: "contact", label: "Contact" },
] as const;

type SectionId = (typeof sections)[number]["id"];

export default function Profile() {
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
                            <SectionContent id={s.id} />
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

function SectionContent({ id }: { id: SectionId }) {
    switch (id) {
        case "profile":
            return (
                <div className="space-y-6">
                    <Avatar className="size-20">
                        <AvatarImage src={user.avatar} alt={user.name} />
                        <AvatarFallback>
                            {user.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                        </AvatarFallback>
                    </Avatar>
                    <div className="space-y-2">
                        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                            {user.name}
                        </h1>
                        <p className="text-lg text-muted-foreground">
                            A short line about who you are and what you do.
                        </p>
                    </div>
                </div>
            );

        case "interest":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Interests</h2>
                    <div className="flex flex-wrap gap-2">
                        {user.intrest?.map((tag) => (
                            <Badge key={tag} variant="outline" className="px-3 py-1 text-sm">
                                {tag}
                            </Badge>
                        ))}
                    </div>
                </div>
            );

        case "projects":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Projects</h2>
                    <ul className="space-y-4">
                        {["Project One", "Project Two", "Project Three"].map((p) => (
                            <li key={p} className="border-b pb-4">
                                <p className="font-medium">{p}</p>
                                <p className="text-sm text-muted-foreground">
                                    One-line description of the project.
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>
            );

        case "experience":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Experience</h2>
                    <div className="space-y-1">
                        <p className="font-medium">Role — Company</p>
                        <p className="text-sm text-muted-foreground">Month YYYY – Present</p>
                    </div>
                </div>
            );

        case "contact":
            return (
                <div className="space-y-6">
                    <h2 className="text-4xl font-bold tracking-tight">Contact</h2>
                    <div className="flex flex-wrap gap-3">
                        <Button>
                            <a href={`mailto:${user.email}`}>Email</a>
                        </Button>
                        <Button variant="outline">
                            <a href="https://linkedin.com" target="_blank" rel="noreferrer">
                                LinkedIn
                            </a>
                        </Button>
                    </div>
                </div>
            );
    }
}