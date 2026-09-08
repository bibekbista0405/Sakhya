"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { Socket } from "socket.io-client";
import { useAuth } from "@/hooks/useAuth";
import { connectSocket, disconnectSocket } from "@/lib/socket";

interface SocketContextValue {
  socket: Socket | null;
  onlineUserIds: Set<string>;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  onlineUserIds: new Set(),
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token || !user) {
      disconnectSocket();
      setSocket(null);
      setOnlineUserIds(new Set());
      return;
    }

    const s = connectSocket(token);
    setSocket(s);

    const onOnlineUsers = (data: { userIds: string[] }) => {
      setOnlineUserIds(new Set(data.userIds));
    };
    const onUserOnline = (data: { userId: string }) => {
      setOnlineUserIds((prev) => new Set(prev).add(data.userId));
    };
    const onUserOffline = (data: { userId: string }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(data.userId);
        return next;
      });
    };

    s.on("online_users", onOnlineUsers);
    s.on("user_online", onUserOnline);
    s.on("user_offline", onUserOffline);

    return () => {
      s.off("online_users", onOnlineUsers);
      s.off("user_online", onUserOnline);
      s.off("user_offline", onUserOffline);
    };
  }, [token, user]);

  return (
    <SocketContext.Provider value={{ socket, onlineUserIds }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
