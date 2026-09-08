"use client";

import dynamic from "next/dynamic";

// Call UI pulls in WebRTC-adjacent state/markup that logged-out routes (login,
// register) never need. Deferring it out of the initial bundle keeps first load
// on those routes lighter; it mounts client-side right after hydration.
const CallLayer = dynamic(() => import("@/components/calls/CallLayer").then((m) => m.CallLayer), {
  ssr: false,
});

export function CallLayerLazy() {
  return <CallLayer />;
}
