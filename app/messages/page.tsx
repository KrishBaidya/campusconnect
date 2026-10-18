import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getViewer } from "@/lib/people";
import { AppShell } from "@/components/aluminx/app-shell";
import { MessagesApp } from "@/components/messages/messages-app";

export const metadata: Metadata = { title: "Messages · AluminX" };

export default function MessagesPage({ searchParams }: PageProps<"/messages">) {
  return (
    <Suspense fallback={<MessagesSkeleton />}>
      <Messages searchParams={searchParams} />
    </Suspense>
  );
}

// Reads the session cookie, so it renders per request inside the Suspense boundary.
async function Messages({ searchParams }: Pick<PageProps<"/messages">, "searchParams">) {
  const user = await getUser();
  if (!user) redirect("/signin?next=/messages");

  const [viewer, { c, to }] = await Promise.all([
    getViewer(user.id, (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined),
    searchParams,
  ]);

  return (
    <AppShell viewer={viewer} active="messages">
      <MessagesApp
        me={user.id}
        initialConversationId={typeof c === "string" ? c : undefined}
        initialRecipientId={typeof to === "string" ? to : undefined}
      />
    </AppShell>
  );
}

function MessagesSkeleton() {
  return (
    <div className="ax">
      <div className="msgs" aria-busy="true">
        <div className="convs">
          <div className="convs-h">
            <h1>Messages</h1>
            <span className="skel" style={{ height: 40, borderRadius: 12 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
