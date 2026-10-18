import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getPerson, getViewer } from "@/lib/people";
import { AppShell } from "@/components/aluminx/app-shell";
import { ProfileView } from "@/components/aluminx/profile-view";
import { ProfileSkeleton } from "@/components/aluminx/profile-skeleton";

export const metadata: Metadata = { title: "Your profile · AluminX" };

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <MyProfile />
    </Suspense>
  );
}

async function MyProfile() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/profile");

  const viewer = await getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined);
  const person = viewer.onboarded ? await getPerson(user.id, viewer) : null;
  if (!person) redirect("/onboarding");

  return (
    <AppShell viewer={viewer} active="profile">
      <ProfileView person={person} isMe />
    </AppShell>
  );
}
