import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2.5">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function MessageBubbleSkeleton({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div className={cn("flex", align === "right" ? "justify-end" : "justify-start")}>
      <Skeleton className="h-10 w-2/5 rounded-2xl" />
    </div>
  );
}
