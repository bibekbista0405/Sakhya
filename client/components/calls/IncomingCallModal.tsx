"use client";

import { Phone, PhoneOff, Video } from "lucide-react";
import { useCall } from "@/hooks/useCall";
import { Avatar } from "@/components/ui/Avatar";

export function IncomingCallModal() {
  const { phase, remoteUser, callType, acceptCall, rejectCall } = useCall();

  if (phase !== "ringing" || !remoteUser) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl bg-surface p-8 text-center shadow-xl">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />
          <Avatar src={remoteUser.avatar} name={remoteUser.username} size={88} />
        </div>
        <div>
          <p className="text-lg font-semibold">{remoteUser.username}</p>
          <p className="text-sm text-muted">
            Incoming {callType === "video" ? "video" : "voice"} call
          </p>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={rejectCall}
            aria-label="Decline call"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white hover:opacity-90"
          >
            <PhoneOff size={24} />
          </button>
          <button
            onClick={acceptCall}
            aria-label="Accept call"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white hover:opacity-90"
          >
            {callType === "video" ? <Video size={24} /> : <Phone size={24} />}
          </button>
        </div>
      </div>
    </div>
  );
}
