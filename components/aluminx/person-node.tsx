import { cn } from "@/lib/utils";

/** The rounded initials tile from the mockups; shows the avatar photo when there is one. */
export function PersonNode({
  person,
  size,
  className,
}: {
  person: { initials: string; hue: number; avatarUrl: string | null; name: string };
  size?: "sm" | "lg" | "xl";
  className?: string;
}) {
  return (
    <span className={cn("node", size, className)} style={{ "--h": person.hue } as React.CSSProperties}>
      {person.avatarUrl ? (
        // Avatars come from Google/GitHub CDNs; a plain img avoids configuring next/image remote hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        person.initials
      )}
      <span className="sr">{person.name}</span>
    </span>
  );
}
