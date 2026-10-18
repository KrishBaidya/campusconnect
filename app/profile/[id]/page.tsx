import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getPerson, getViewer } from "@/lib/people";
import { getRequestContext } from "@/lib/mentorship";
import { AppShell } from "@/components/aluminx/app-shell";
import { ProfileView } from "@/components/aluminx/profile-view";
import { ProfileSkeleton } from "@/components/aluminx/profile-skeleton";

export const metadata: Metadata = { title: "Profile · AluminX" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PersonPage({ params }: PageProps<"/profile/[id]">) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: Pick<PageProps<"/profile/[id]">, "params">) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect(`/signin?next=/profile/${encodeURIComponent(id)}`);
  if (id === user.id) redirect("/profile");
  if (!UUID.test(id)) notFound();

  const viewer = await getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined);
  const [person, mentorship] = await Promise.all([getPerson(id, viewer), getRequestContext(id, user.id)]);
  if (!person) notFound();

  return (
    <AppShell viewer={viewer} active="discover">
      <ProfileView person={person} isMe={false} mentorship={mentorship} />
    </AppShell>
  );
}
