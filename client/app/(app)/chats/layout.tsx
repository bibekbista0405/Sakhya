"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChatList } from "@/components/chat/ChatList";
import { cn } from "@/lib/utils";

export default function ChatsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasActiveChat = pathname !== "/chats";

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className={cn("h-full min-h-0 w-full sm:block sm:w-auto", hasActiveChat && "hidden sm:block")}>
        <ChatList />
      </div>
      <div className={cn("min-h-0 flex-1", hasActiveChat ? "flex" : "hidden sm:flex")}>{children}</div>
    </div>
  );
}
