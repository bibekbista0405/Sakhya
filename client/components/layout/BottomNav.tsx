"use client";

import { FastNavLink } from "@/components/layout/FastNavLink";
import { usePathname } from "next/navigation";
import { MessageCircle, Phone, Users, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui/Badge";

const TABS = [
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/notifications", label: "Alerts", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface sm:hidden"
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <FastNavLink
            key={tab.href}
            href={tab.href}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
            aria-current={active ? "page" : undefined}
          >
            <span
              className={cn(
                "relative flex items-center justify-center rounded-full p-1.5 transition-colors",
                active ? "text-accent" : "text-muted"
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              {tab.href === "/notifications" && unreadCount > 0 && (
                <Badge variant="danger" className="absolute -right-1.5 -top-1 h-4 min-w-[1rem] px-1 text-[10px]">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </span>
            <span className={cn("text-[11px] font-medium", active ? "text-accent" : "text-muted")}>
              {tab.label}
            </span>
          </FastNavLink>
        );
      })}
    </nav>
  );
}
