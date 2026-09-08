"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
  useCallback,
} from "react";
import { useSocket } from "@/hooks/useSocket";
import { useAuth } from "@/hooks/useAuth";
import { User } from "@/types";

export type CallPhase = "idle" | "calling" | "ringing" | "connected" | "ended";

interface CallContextValue {
  phase: CallPhase;
  callId: string | null;
  callType: "audio" | "video" | null;
  remoteUser: User | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  duration: number;
  errorMessage: string | null;
  startCall: (friend: User, type: "audio" | "video") => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  clearError: () => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }
  return servers;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const { user } = useAuth();

  const [phase, setPhase] = useState<CallPhase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callType, setCallType] = useState<"audio" | "video" | null>(null);
  const [remoteUser, setRemoteUser] = useState<User | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const targetUserIdRef = useRef<string | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const outgoingCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEndingRef = useRef(false);

  const resetState = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    callIdRef.current = null;
    targetUserIdRef.current = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    outgoingCandidatesBufferRef.current = [];

    setPhase("idle");
    setCallId(null);
    setCallType(null);
    setRemoteUser(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setDuration(0);
    isEndingRef.current = false;
  }, []);

  const createPeerConnection = useCallback(
    (targetId: string) => {
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidateJson = event.candidate.toJSON();
        if (callIdRef.current && socket) {
          socket.emit("ice_candidate", {
            callId: callIdRef.current,
            targetId,
            candidate: candidateJson,
          });
        } else {
          outgoingCandidatesBufferRef.current.push(candidateJson);
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          setPhase("connected");
          if (!timerRef.current) {
            setDuration(0);
            timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
          }
          if (callIdRef.current && socket) {
            socket.emit("call_connected", { callId: callIdRef.current });
          }
        } else if (pc.connectionState === "failed") {
          setErrorMessage("Call connection failed. A TURN server may be required on this network.");
          if (!isEndingRef.current && socket && callIdRef.current) {
            socket.emit("end_call", { callId: callIdRef.current });
          }
          resetState();
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [socket]
  );

  const startCall = useCallback(
    async (friend: User, type: "audio" | "video") => {
      if (!socket) return;
      setErrorMessage(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === "video",
        });
        localStreamRef.current = stream;
        setLocalStream(stream);

        targetUserIdRef.current = friend.id;
        setRemoteUser(friend);
        setCallType(type);
        setPhase("calling");

        const pc = createPeerConnection(friend.id);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("call_user", { receiverId: friend.id, type, offer });
        connectionTimeoutRef.current = setTimeout(() => {
          if (pc.connectionState !== "connected" && callIdRef.current && socket) {
            setErrorMessage("No connection could be established. Check microphone/network permissions.");
            socket.emit("end_call", { callId: callIdRef.current });
            resetState();
          }
        }, 30000);
      } catch (err) {
        setErrorMessage(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera/microphone permission denied"
            : "Could not access camera or microphone"
        );
        resetState();
      }
    },
    [socket, createPeerConnection, resetState]
  );

  const acceptCall = useCallback(async () => {
    if (!socket || !pendingOfferRef.current || !callIdRef.current || !targetUserIdRef.current) return;
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video",
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection(targetUserIdRef.current);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));

      // flush any ICE candidates that arrived before pc existed
      for (const cand of pendingCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
      pendingCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("call_accepted", { callId: callIdRef.current, answer });

      // flush any buffered outgoing candidates gathered before callId was set (n/a for callee, but safe)
      for (const cand of outgoingCandidatesBufferRef.current) {
        socket.emit("ice_candidate", {
          callId: callIdRef.current,
          targetId: targetUserIdRef.current,
          candidate: cand,
        });
      }
      outgoingCandidatesBufferRef.current = [];

      setPhase("calling");
      connectionTimeoutRef.current = setTimeout(() => {
        if (pc.connectionState !== "connected" && callIdRef.current && socket) {
          setErrorMessage("The call could not connect. Check microphone/network permissions.");
          socket.emit("end_call", { callId: callIdRef.current });
          resetState();
        }
      }, 30000);
    } catch {
      setErrorMessage("Could not access camera or microphone");
      if (callIdRef.current) socket.emit("call_rejected", { callId: callIdRef.current });
      resetState();
    }
  }, [socket, callType, createPeerConnection, resetState]);

  const rejectCall = useCallback(() => {
    isEndingRef.current = true;
    if (socket && callIdRef.current) {
      socket.emit("call_rejected", { callId: callIdRef.current });
    }
    resetState();
  }, [socket, resetState]);

  const endCall = useCallback(() => {
    isEndingRef.current = true;
    if (socket && callIdRef.current) {
      socket.emit("end_call", { callId: callIdRef.current });
    }
    resetState();
  }, [socket, resetState]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    const newMuted = !isMuted;
    audioTracks.forEach((t) => (t.enabled = !newMuted));
    setIsMuted(newMuted);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    const newOff = !isCameraOff;
    videoTracks.forEach((t) => (t.enabled = !newOff));
    setIsCameraOff(newOff);
  }, [isCameraOff]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  // Socket event wiring
  useEffect(() => {
    if (!socket) return;

    const onCallInitiated = (data: { callId: string; receiverId: string }) => {
      callIdRef.current = data.callId;
      setCallId(data.callId);
      // flush any ICE candidates queued before we had a callId
      if (outgoingCandidatesBufferRef.current.length && targetUserIdRef.current) {
        for (const cand of outgoingCandidatesBufferRef.current) {
          socket.emit("ice_candidate", {
            callId: data.callId,
            targetId: targetUserIdRef.current,
            candidate: cand,
          });
        }
        outgoingCandidatesBufferRef.current = [];
      }
    };

    const onIncomingCall = (data: {
      callId: string;
      type: "audio" | "video";
      offer: RTCSessionDescriptionInit;
      caller: User;
    }) => {
      // If already in a call, ignore (auto-busy) — a fuller product could auto-decline with a message.
      if (phase !== "idle") return;
      callIdRef.current = data.callId;
      targetUserIdRef.current = data.caller.id;
      pendingOfferRef.current = data.offer;
      setCallId(data.callId);
      setCallType(data.type);
      setRemoteUser(data.caller);
      setPhase("ringing");
    };

    const onCallAccepted = async (data: { callId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (!pc || data.callId !== callIdRef.current) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      for (const cand of pendingCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
      pendingCandidatesRef.current = [];
      setPhase("calling");
    };

    const onCallRejected = () => {
      setErrorMessage("Call was declined");
      resetState();
    };

    const onCallFailed = (data: { reason: string }) => {
      setErrorMessage(data.reason || "Call failed");
      resetState();
    };

    const onIceCandidate = async (data: { callId: string; candidate: RTCIceCandidateInit }) => {
      if (data.callId !== callIdRef.current) return;
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          // ignore malformed/late candidates
        }
      } else {
        pendingCandidatesRef.current.push(data.candidate);
      }
    };

    const onCallEnded = () => {
      resetState();
    };

    socket.on("call_initiated", onCallInitiated);
    socket.on("incoming_call", onIncomingCall);
    socket.on("call_accepted", onCallAccepted);
    socket.on("call_rejected", onCallRejected);
    socket.on("call_failed", onCallFailed);
    socket.on("ice_candidate", onIceCandidate);
    socket.on("call_ended", onCallEnded);

    return () => {
      socket.off("call_initiated", onCallInitiated);
      socket.off("incoming_call", onIncomingCall);
      socket.off("call_accepted", onCallAccepted);
      socket.off("call_rejected", onCallRejected);
      socket.off("call_failed", onCallFailed);
      socket.off("ice_candidate", onIceCandidate);
      socket.off("call_ended", onCallEnded);
    };
  }, [socket, phase, resetState]);

  // Clean up any lingering call state on logout
  useEffect(() => {
    if (!user) resetState();
  }, [user, resetState]);

  return (
    <CallContext.Provider
      value={{
        phase,
        callId,
        callType,
        remoteUser,
        localStream,
        remoteStream,
        isMuted,
        isCameraOff,
        duration,
        errorMessage,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleCamera,
        clearError,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
