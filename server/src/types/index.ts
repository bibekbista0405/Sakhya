// Minimal WebRTC signaling payload shapes (server just relays these opaquely).
export interface RTCSessionDescriptionInit {
  type: string;
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password: string;
  avatar: string;
  bio: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  createdAt: string;
}

export interface PublicUser {
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
}

export interface BlockedUserRow {
  id: string;
  userId: string;
  blockedId: string;
  createdAt: string;
}

export interface AuthPayload {
  userId: string;
  username: string;
}

export interface FriendRequestRow {
  id: string;
  senderId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface MessageRow {
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
  isEncrypted?: number;
  ciphertext?: string | null;
  olmMessageType?: number | null;
  senderDeviceId?: string | null;
  expiresAt?: string | null;
}

export interface CallRow {
  id: string;
  callerId: string;
  receiverId: string;
  type: "audio" | "video";
  status: "missed" | "completed" | "rejected" | "outgoing_cancelled";
  duration: number;
  startedAt: string;
  endedAt: string | null;
}

export interface NotificationRow {
  id: string;
  userId: string;
  type: "message" | "friend_request" | "friend_accept" | "missed_call" | "incoming_call";
  content: string;
  relatedId: string | null;
  isRead: number;
  createdAt: string;
}

// --- E2EE device / key management (Phase 2) -------------------------------
//
// The server only ever stores PUBLIC key material. Private keys are generated
// and kept on the user's device (e.g. in IndexedDB) and never transmitted.
// Cryptography uses the Olm Double Ratchet implementation (the same
// construction underlying the Signal Protocol), not a custom scheme.

export interface DeviceRow {
  id: string;
  userId: string;
  name: string;
  curveIdentityKey: string; // Curve25519 public identity key, base64
  ed25519IdentityKey: string; // Ed25519 public signing key, base64
  fallbackKeyId: string | null;
  fallbackKey: string | null; // signed fallback one-time prekey, used when the OTK pool is empty
  fallbackKeySignature: string | null;
  createdAt: string;
  lastActiveAt: string;
  revokedAt: string | null;
}

export interface PublicDevice {
  id: string;
  name: string;
  curveIdentityKey: string;
  ed25519IdentityKey: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface OneTimePrekeyRow {
  id: string;
  deviceId: string;
  keyId: string;
  publicKey: string;
  claimedByUserId: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface PrekeyBundle {
  deviceId: string;
  deviceName: string;
  curveIdentityKey: string;
  ed25519IdentityKey: string;
  // Exactly one of these is present: a one-time key (preferred, single-use) or
  // the device's signed fallback key (reused only when one-time keys run out).
  oneTimeKey: { keyId: string; publicKey: string } | null;
  fallbackKey: { keyId: string; publicKey: string; signature: string } | null;
}

// --- Encrypted attachments (Phase 4) ---------------------------------------
export interface AttachmentRow {
  id: string;
  senderId: string;
  receiverId: string;
  messageId: string | null;
  storagePath: string;
  ciphertextSize: number;
  createdAt: string;
  viewOnce: number;
  consumedAt: string | null;
}
