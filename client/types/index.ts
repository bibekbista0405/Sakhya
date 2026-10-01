export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string;
  bio: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  createdAt: string;
  online?: boolean;
  lastSeenAt?: string | null;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  status: "sent" | "delivered" | "seen";
  replyToId: string | null;
  replyToContent?: string | null;
  replyToSenderId?: string | null;
  reactions: Record<string, string[]>;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  // E2EE fields (Phase 2). isEncrypted=0 marks legacy/pre-E2EE messages that
  // were never protected — the UI must show this honestly, never imply they
  // were secured retroactively.
  isEncrypted?: boolean;
  ciphertext?: string | null;
  olmMessageType?: 0 | 1 | null;
  senderDeviceId?: string | null;
  decryptError?: boolean;
  securityCodeChanged?: boolean;
  expiresAt?: string | null;
  isStarred?: boolean;
  // Ephemeral client correlation id used only to reconcile the sender's
  // local plaintext with the server echo. It is never persisted in SQLite.
  clientMessageId?: string;
}

export interface Conversation {
  friend: User;
  lastMessage: Message | null;
  unreadCount: number;
  isLocked?: boolean;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  username: string;
  avatar: string;
}

export interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  type: "audio" | "video";
  status: "missed" | "completed" | "rejected" | "outgoing_cancelled";
  duration: number;
  startedAt: string;
  endedAt: string | null;
  direction: "incoming" | "outgoing";
  displayStatus: string;
  otherUser: User | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: "message" | "friend_request" | "friend_accept" | "missed_call" | "incoming_call";
  content: string;
  relatedId: string | null;
  isRead: number;
  createdAt: string;
  // Only present on live socket-delivered notifications (not history fetches):
  // lets the client show a richer OS notification when the user's preference
  // is "full" but the server had to degrade the stored text because the
  // message was encrypted — the client may already have the plaintext.
  upgradableToFull?: boolean;
  senderId?: string;
}

export interface IncomingCallData {
  callId: string;
  type: "audio" | "video";
  offer: RTCSessionDescriptionInit;
  caller: User;
}

export type NotificationContentLevel = "full" | "sender" | "generic" | "hidden";

export interface PrivacySettings {
  readReceipts: boolean;
  typingIndicators: boolean;
  onlineStatus: boolean;
  lastSeenVisibility: "everyone" | "friends" | "nobody";
  notificationContentLevel: NotificationContentLevel;
}
