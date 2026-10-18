import { ConnectionHub } from "@/components/connection_hub";
import Link from "next/link";

export default function Home() {
  
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <h1> 
        Hello!!
      </h1>
      <ConnectionHub />
      <div className="mt-6 flex gap-4 text-sm font-medium">
        <Link href="/discover" className="underline underline-offset-4">
          Discover
        </Link>
        <Link href="/profile" className="underline underline-offset-4">
          Profile
        </Link>
        <Link href="/messages" className="underline underline-offset-4">
          Messages
        </Link>
      </div>
    </div>
  );
}
