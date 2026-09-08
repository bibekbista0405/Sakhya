"use client";

import { FastNavLink } from "@/components/layout/FastNavLink";
import { usePathname } from "next/navigation";
import { MessageCircle, Phone, Bell, User, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui/Badge";

const TABS = [
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function TopNav() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  return (
    <header className="hidden h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:flex">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
          <MessageCircle size={18} />
        </div>
        <span className="text-base font-semibold">Sakhya</span>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <FastNavLink
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-black/5 hover:text-foreground"
              )}
            >
              <Icon size={18} />
              <span className="hidden lg:inline">{tab.label}</span>
              {tab.href === "/notifications" && unreadCount > 0 && (
                <Badge variant="danger" className="absolute -right-1 -top-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </FastNavLink>
          );
        })}
      </nav>
    </header>
  );
}
