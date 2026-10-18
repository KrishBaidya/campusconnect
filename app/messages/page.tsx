import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MessagesApp } from "@/components/messages/messages-app";

export const metadata: Metadata = { title: "Messages · Campus Connect" };

export default function MessagesPage({ searchParams }: PageProps<"/messages">) {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Messages searchParams={searchParams} />
    </Suspense>
  );
}

// Reads the session cookie, so it renders per request inside the Suspense boundary.
async function Messages({ searchParams }: Pick<PageProps<"/messages">, "searchParams">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/signin?next=/messages");

  const { c, to } = await searchParams;

  return (
    <MessagesApp
      me={userId}
      initialConversationId={typeof c === "string" ? c : undefined}
      initialRecipientId={typeof to === "string" ? to : undefined}
    />
  );
}
