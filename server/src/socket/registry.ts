import { Server } from "socket.io";

// userId -> Set of socket ids (a user can have multiple tabs/devices)
export const onlineUsers = new Map<string, Set<string>>();

let ioInstance: Server | null = null;

export function setIo(io: Server): void {
  ioInstance = io;
}

export function getIo(): Server {
  if (!ioInstance) throw new Error("Socket.IO server not initialized yet");
  return ioInstance;
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId) && (onlineUsers.get(userId)?.size ?? 0) > 0;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  const sockets = onlineUsers.get(userId);
  if (!sockets || sockets.size === 0) return;
  const io = getIo();
  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload);
  }
}
