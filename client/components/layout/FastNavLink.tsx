"use client";

import Link, { LinkProps } from "next/link";
import { AnchorHTMLAttributes, ReactNode } from "react";

interface FastNavLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">,
    Omit<LinkProps, "href"> {
  href: string;
  children: ReactNode;
}

/**
 * Lightweight navigation wrapper.
 *
 * The previous implementation manually called router.prefetch() on hover/touch
 * for every navigation item. Combined with the global route warmup, this could
 * cause several route/RSC requests to compete in development and make clicks
 * feel unresponsive. Next.js Link already provides route prefetching, so keep
 * navigation on the native Next Link path and let Next manage its prefetch
 * lifecycle.
 */
export function FastNavLink({ href, children, ...props }: FastNavLinkProps) {
  return (
    <Link {...props} href={href} prefetch>
      {children}
    </Link>
  );
}
