import { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-14 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={26} />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
    </div>
  );
}
