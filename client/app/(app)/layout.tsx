"use client";

import { useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { TopNav } from "@/components/layout/TopNav";
import { BottomNav } from "@/components/layout/BottomNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    // 100dvh (dynamic viewport height) avoids the classic mobile-browser bug where
    // 100vh is taller than the visible area once the address bar is accounted for.
    <div className="flex h-[100dvh] flex-col">
      <TopNav />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] sm:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
