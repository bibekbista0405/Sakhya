import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
  variant = "accent",
}: {
  children: ReactNode;
  className?: string;
  variant?: "accent" | "danger" | "muted";
}) {
  const variants = {
    accent: "bg-accent text-white",
    danger: "bg-danger text-white",
    muted: "bg-black/5 text-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold leading-none min-w-[1.25rem]",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
