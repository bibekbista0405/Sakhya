import Image from "next/image";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  online?: boolean;
  className?: string;
}

export function Avatar({ src, name, size = 40, online, className }: AvatarProps) {
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      {src ? (
        <Image
          src={src}
          alt={name}
          width={size}
          height={size}
          className="rounded-full object-cover bg-accent-soft"
          unoptimized
        />
      ) : (
        <div
          className="rounded-full bg-accent-soft text-accent flex items-center justify-center font-semibold"
          style={{ width: size, height: size, fontSize: size * 0.38 }}
        >
          {initials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-surface",
            online ? "bg-success" : "bg-gray-300"
          )}
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  );
}
