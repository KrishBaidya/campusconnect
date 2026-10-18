import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ProfileView, type ProfileViewData } from "@/components/profile-view";

export default function ProfilePage() {
    return (
        <Suspense fallback={<main className="grid min-h-dvh place-items-center text-muted-foreground">Loading profile…</main>}>
            <MyProfile />
        </Suspense>
    );
}

const ym = (d: Date | null) =>
    d ? d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }) : null;

async function MyProfile() {
    const user = await getUser();
    if (!user) redirect("/signin");

    const p = await prisma.profile.findUnique({
        where: { id: user.id },
        include: { college: true, experiences: { orderBy: { startDate: "desc" } } },
    });
    if (!p?.onboardedAt) redirect("/onboarding");

    const data: ProfileViewData = {
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || user.email || "Member",
        email: user.email ?? "",
        avatar: p.avatarUrl,
        headline: p.headline,
        bio: p.bio,
        role: p.role,
        college: p.college?.name,
        batchYear: p.batchYear,
        interests: p.interests,
        expertise: p.expertise,
        intents: p.intents,
        projects: Array.isArray(p.projects) ? (p.projects as ProfileViewData["projects"]) : [],
        experiences: p.experiences.map((e) => ({ company: e.company, jobRole: e.jobRole, start: ym(e.startDate), end: ym(e.endDate) })),
        githubUrl: p.githubUrl,
        linkedinUrl: p.linkedinUrl,
    };

    return <ProfileView user={data} />;
}
