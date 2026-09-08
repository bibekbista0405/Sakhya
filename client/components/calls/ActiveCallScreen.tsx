"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { useCall } from "@/hooks/useCall";
import { Avatar } from "@/components/ui/Avatar";
import { formatDuration } from "@/lib/utils";

export function ActiveCallScreen() {
  const {
    phase,
    callType,
    remoteUser,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    duration,
    toggleMute,
    toggleCamera,
    endCall,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (callType === "video" && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (callType === "audio" && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callType]);

  if ((phase !== "calling" && phase !== "connected") || !remoteUser) return null;

  const isVideo = callType === "video";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#111318] text-white">
      <audio ref={remoteAudioRef} autoPlay />

      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {isVideo ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {!remoteStream && (
              <div className="z-10 flex flex-col items-center gap-3">
                <Avatar src={remoteUser.avatar} name={remoteUser.username} size={96} />
                <p className="text-lg font-medium">{remoteUser.username}</p>
              </div>
            )}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-24 right-4 h-36 w-24 rounded-lg border border-white/20 object-cover sm:h-48 sm:w-32"
            />
          </>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Avatar src={remoteUser.avatar} name={remoteUser.username} size={120} />
            <p className="text-xl font-semibold">{remoteUser.username}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 pb-2 text-center">
        <p className="text-sm text-white/70">
          {phase === "calling" ? "Calling..." : formatDuration(duration)}
        </p>
      </div>

      <div className="flex items-center justify-center gap-6 pb-10 pt-4">
        <button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>

        {isVideo && (
          <button
            onClick={toggleCamera}
            aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            {isCameraOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}

        <button
          onClick={endCall}
          aria-label="End call"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-danger hover:opacity-90"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}
