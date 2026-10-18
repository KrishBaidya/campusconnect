import { ConnectionHub } from "@/components/connection_hub";
import Link from "next/link";

export default function Home() {
  
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <h1> 
        Hello!!
      </h1>
      <ConnectionHub />
      <Link href="/messages" className="mt-6 text-sm font-medium underline underline-offset-4">
        Messages
      </Link>
    </div>
  );
}
