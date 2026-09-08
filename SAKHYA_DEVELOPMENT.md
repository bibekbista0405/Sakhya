# Sakhya Development Roadmap

## Phase 1 — Privacy foundation (implemented)
- Account-level privacy preferences
- Read receipt control
- Typing indicator preference
- Online status preference
- Last-seen visibility
- Notification message-preview preference
- Privacy settings persisted server-side
- Read-receipt behavior respects the setting
- Basic HTTP security headers
- Single workspace/lockfile structure

## Phase 2 — E2EE architecture (next)
- Per-device identity keys
- Public-key registration
- Local private-key storage
- Conversation key establishment
- Message encryption/decryption on the client
- Key rotation
- Safety-number / QR verification
- Encrypted attachments

Important: Sakhya must not claim that Phase 2 is complete until ciphertext is actually used end-to-end and the implementation has been reviewed.

---

## Production Transformation Status (updated 2026-09-04)

Tracking against the 30-phase production transformation plan. Only phases listed
under "Done" have been implemented AND verified (typecheck + build + live
integration test); everything else is still outstanding. Nothing below is
aspirational — if it's not listed as done, it does not exist in the codebase yet.

### Done and verified

**Phase 1 — Security Foundation**
- Fixed a real vulnerability: `requireAuth` previously validated only the JWT
  signature and never checked the `sessions` table, so "logout" did not
  actually invalidate a bearer token (it stayed usable until its 7-day JWT
  expiry). Every REST request and the Socket.IO handshake now require a live
  session row. Verified live: token worked pre-logout, got 401 immediately
  post-logout.
- `helmet` + per-route rate limiting (`express-rate-limit`) on login,
  register, password change, account deletion, friend requests; a custom
  in-memory sliding-window limiter on the Socket.IO `send_message` event
  (Socket.IO bypasses Express middleware, so REST rate limiting alone doesn't
  cover it).
- `JWT_SECRET` now hard-fails server startup in production if missing or
  under 32 chars. bcrypt cost 10 → 12. Password minimum 6 → 8 chars. Login
  compares against a dummy hash even for unknown emails to reduce
  user-enumeration via timing. Account deletion now requires password
  re-confirmation (client UI updated to match).
- Device/session tracking: `sessions` table gained `deviceName`, `userAgent`,
  `ip`, `lastActiveAt`. New endpoints: `GET/DELETE /api/auth/sessions`,
  `POST /api/auth/logout-all`.

**Phase 2 — E2EE architecture (backend + client core loop DONE and verified; not yet complete end-to-end)**
- Crypto engine selected: Olm (Matrix's Double Ratchet implementation, the
  same construction underlying the Signal Protocol, audited by NCC Group),
  not a homemade scheme.
- New tables: `devices` (per-device Curve25519 + Ed25519 public identity
  keys, signed fallback key), `one_time_prekeys`. Server stores public
  material only — no private key ever transits these endpoints by design.
- Backend routes, all implemented and integration-tested against a live server:
  `POST /api/devices/register`, `POST /api/devices/prekeys`,
  `GET /api/devices/bundle/:userId` (claims and consumes a one-time key,
  friends-only, blocked-user-checked), `GET /api/devices/identity/:userId`
  (public-key lookup without consuming a prekey, needed for decrypt-side
  session setup), `GET /api/devices`, `DELETE /api/devices/:id` (cascades to
  kill the linked login session).
- Client crypto engine (`lib/crypto.ts`, `lib/idb.ts`, `lib/messageStore.ts`,
  `lib/messageDecrypt.ts`): generates and persists a per-browser Olm identity
  in IndexedDB, registers it with the server on login/register
  (`hooks/useAuth.tsx`), establishes outbound sessions via the bundle
  endpoint, and encrypts/decrypts messages in `ChatWindow.tsx`. Server
  socket handlers (`send_message`/`edit_message`/`delete_message`) now store
  ciphertext instead of plaintext when a client sends encrypted fields; a
  legacy plaintext path is still accepted for backward compatibility during
  rollout.
- **Verified end-to-end with a real integration test** (`/tmp/e2ee_test`,
  not part of the shipped repo): two real Olm accounts, real device
  registration, real friend relationship, real prekey-bundle claim over the
  live REST API, real Socket.IO transport, real Double Ratchet
  encrypt/decrypt. Confirmed: (a) decrypted plaintext exactly matches what
  was sent, (b) the server's `content` column is empty for encrypted
  messages — it never sees plaintext, (c) a second message on the same
  session round-trips correctly as the ratchet advances. Both client and
  server typecheck and build cleanly with all of this in place.

**Known limitations of the current E2EE implementation (not yet solved):**
1. **Single-device fan-out only.** If a recipient has multiple registered
   devices, the sender only encrypts for the most-recently-active one.
   Real multi-device fan-out (a separately-encrypted copy per device, as
   Signal/WhatsApp do) is not implemented.
2. **No cross-device / cross-session history for encrypted messages.**
   Because Olm's ratchet does not support arbitrary re-decryption of
   already-processed ciphertext, the client caches decrypted plaintext
   locally (IndexedDB) the first time it sees a message and never
   re-decrypts it. A message decrypted on one device/browser profile is not
   readable from another device, and if the local cache is ever cleared,
   that message becomes permanently unreadable. There is currently no local
   plaintext backup/export mechanism.
3. **Sender cannot re-view their own sent messages if the local plaintext
   cache is lost** (e.g. cleared browser data), for the same forward-secrecy
   reason — Olm doesn't let a sender re-decrypt their own outbound
   ciphertext from scratch.
4. **Server-side message search (Phase 8) and plaintext notification
   previews no longer work for encrypted messages**, by design — the server
   can't read the content. Notifications for encrypted messages now say
   "X sent you a message" instead of a preview. A client-side search over
   locally-cached plaintext has not been built yet.
5. **No safety-number / identity-change verification yet (Phase 3)** — if a
   contact's identity key changes (e.g. they reinstalled/reset their
   device), nothing currently warns the user. This is the most
   security-relevant gap remaining and should be next.
6. IndexedDB key storage has no passphrase/PIN protection (planned to pair
   with Phase 6 Chat Lock) — anyone with access to the unlocked browser
   profile can read local key material, same limitation noted in Phase 1.

### Explicitly NOT started
Phase 4 (encrypted media/files), disappearing messages, view-once, chat lock,
notification-content privacy settings UI, messaging-quality polish beyond
what already existed, calling/TURN work, 2FA/passkeys/recovery codes,
privacy center UI, groups + group encryption, group calls/SFU, the
performance/mobile/accessibility/error-handling/offline passes, structured
logging, the automated test suite, and the README/SECURITY.md documentation
pass.

## Phase 3 — Security verification (done, client-side, logic-tested)

- **Trust model** (`lib/trust.ts`): trust-on-first-use (TOFU), same default
  behavior as Signal/WhatsApp. The first identity key seen for a contact is
  pinned locally (IndexedDB) with no warning. If it later changes, the pin is
  **not** silently overwritten — `checkIdentity()` keeps returning
  `changed: true` on every check until the user (or the app, on receive)
  explicitly calls `acceptChangedIdentity()`.
- **Blocking vs non-blocking, matching mainstream messenger defaults:**
  sending (`encryptForPeer`) throws `IdentityKeyChangedError` and refuses to
  send under a changed, unacknowledged key. Receiving (`decryptFromPeer`)
  does NOT block — it decrypts (so a legitimate device change doesn't
  silently drop messages) but returns `securityCodeChanged: true` so the UI
  can show a warning banner.
- **Security code / safety number**: SHA-256 over both parties' Ed25519
  identity keys in canonical (sorted) order, rendered as 12 groups of 5
  digits. This is our own straightforward fingerprint construction, not a
  byte-for-byte port of Signal's iterated-hash algorithm — documented as
  such in the code so it's never confused with cross-app interoperability.
  It has the property that matters: deterministic per key-pair regardless of
  who computes it, and any substituted key produces a different code.
- **UI** (`components/chat/SecurityVerification.tsx`): per-conversation panel
  reachable from a shield icon in the chat header, showing the security code
  as both digit groups and a QR code (via the `qrcode` package), a
  verified/unverified toggle (a user attestation, not something the code can
  determine itself), and — when a key change is detected — a prominent
  warning with an explicit "Accept new code" action. A blocked send
  automatically opens this panel with the draft preserved, and resends once
  accepted.
- **What "QR verification" means here**: only QR *generation* for display/
  comparison is implemented (e.g. two people photograph or eyeball-compare
  each other's screens). Camera-based QR *scanning* is not implemented —
  that would need camera permission UI and a scanning library, which is a
  separate chunk of work.
- **Verification approach**: the actual `lib/trust.ts` module is a
  `"use client"` file depending on `indexedDB`/`crypto.subtle`, so it can't
  run standalone in this sandbox. I re-implemented the identical state
  machine (TOFU pin, non-silent flagging, persistence until accept,
  symmetric+substitution-sensitive code) in a plain Node script and ran 8
  assertions against it — all passed, including that a substituted identity
  key produces a different security code (the MITM-detection property this
  phase exists for). That confirms the *logic* is correct; it has not been
  exercised through an actual browser yet (no browser available in this
  environment), so treat the UI wiring itself as build-verified but not
  click-tested.
- Both client and server typecheck and build cleanly with Phase 3 included.

## Phase 4 — Encrypted media & files (done, verified end-to-end)

- **Architecture**: each file gets its own random AES-256-GCM key/IV
  (Web Crypto `crypto.subtle`, `lib/attachments.ts`). Only the resulting
  ciphertext bytes are uploaded to the server. The key, IV, real filename,
  and real MIME type are bundled into a small JSON object that becomes the
  plaintext of an ordinary chat message and travels through the existing
  Olm-encrypted pipeline from Phase 2 — so attachment metadata gets the same
  protection as regular text, and the server only ever sees an opaque blob.
- **Server** (`routes/attachments.ts`): `multer` 2.x (deliberately not 1.x,
  which has known CVEs) with disk storage under a configurable
  `ATTACHMENTS_DIR`, random server-side filenames (never the client's
  original name), a 25MB default size cap, a dedicated upload rate limiter,
  friends-only + not-blocked authorization at upload time, sender-or-receiver
  -only authorization at download time, and downloads always served as
  `application/octet-stream` regardless of any claimed type. `send_message`
  links an uploaded attachment to the outgoing message (ownership- and
  receiver-checked, and an attachment can only ever be linked to one
  message — replay of an attachment ID onto a second message is rejected).
  `delete_message` cascades to delete the ciphertext file from disk. An
  hourly sweep purges attachments that were uploaded but never linked to a
  sent message (e.g. an abandoned send).
- **Client** (`components/chat/ChatWindow.tsx`, `MessageBubble.tsx`): a
  paperclip button encrypts and uploads the selected file, then sends the
  metadata as a normal (Olm-encrypted) message. Images/video/audio
  auto-decrypt and render inline; other file types show a tap-to-download
  row. Object URLs are revoked on unmount to avoid leaking decrypted blobs
  in memory longer than needed.
- **Explicit trade-off, documented in the code**: because the server only
  ever holds ciphertext, it cannot do magic-byte MIME sniffing the way a
  normal (non-E2EE) upload endpoint should — the bytes are indistinguishable
  from random data to the server. Signal and WhatsApp accept the same
  limitation for the same reason; it is not an oversight here.
- **Verified with real integration tests** (`/tmp/e2ee_test`, not part of the
  shipped repo) against a live server — 11 assertions across 3 test files,
  all passing:
  - Non-friend upload rejected (403)
  - Real AES-256-GCM encrypt → upload → download → decrypt round trip:
    downloaded ciphertext byte-identical to what was uploaded, and decrypted
    plaintext exactly matches the original file content
  - Sender can re-fetch their own upload; an unrelated third party gets 403
  - Downloads are always served as `application/octet-stream`
  - Oversized upload (30MB against a 25MB limit) rejected with 413
  - Reusing the same `attachmentId` on a second message is rejected
    server-side (with a real Socket.IO client, not a mock)
  - Deleting a message deletes its linked attachment file; a subsequent
    download attempt correctly 404s
- Both client and server typecheck and build cleanly with Phase 4 included.
- **Not yet verified in a browser**: the upload button, inline
  image/video/audio preview, and download-row interaction were build-verified
  only, not click-tested — no browser is available in this environment.

## Phase 5 — Disappearing & private messages (done, verified end-to-end)

- **Disappearing messages**: a per-pair `conversation_settings` table (not
  per-user — either participant can change it and it applies going forward,
  same model as WhatsApp/Signal). `set_disappearing_timer` validates the
  duration against the allowed set (off/30s/1m/5m/1h/1d/7d) and broadcasts
  `disappearing_timer_changed` to both participants. New messages get an
  `expiresAt` computed from that setting. A sweep (`runDisappearingMessageSweep`,
  every 10s) **hard-deletes** — not soft-deletes — expired messages and any
  attachment files they carried, then emits `message_expired` to both sides
  so an open chat updates immediately rather than waiting for the next
  history fetch. The client also does a local, purely cosmetic 1s-interval
  removal of messages whose timer has elapsed, independent of the sweep, for
  a snappier feel — the sweep remains the authoritative enforcement.
- **View-once**: `attachments` gained `viewOnce`/`consumedAt`. A new
  `POST /api/attachments/:id/consume` endpoint — receiver-only — deletes the
  ciphertext immediately; the download endpoint then returns 410 Gone to
  *anyone*, including the original sender. The client shows a tap-to-reveal
  affordance for the recipient (auto-consumes on view, then strips the
  key/IV/attachmentId from its own local plaintext cache so even this
  device can't re-decrypt it later) and a static "sent"/"opened" indicator
  for the sender, who never auto-previews their own view-once send.
- **Documented, unavoidable limitation**: the server cannot verify a client
  actually *displayed* view-once content before calling consume — the
  content is encrypted, so this is inherently client-cooperative, same as
  any E2EE messenger. What's guaranteed is that once consumed, the
  ciphertext is gone from the server for everyone.
- **A real bug found and fixed during testing**: `expiresAt` was first
  computed in JavaScript via `Date.toISOString()` (format
  `2026-01-01T00:00:00.000Z`), but the sweep compared it against SQLite's
  `datetime('now')` (format `2026-01-01 00:00:00`) as a plain string
  comparison — and `T` sorts after a space in ASCII, so the comparison
  silently never matched and expired messages never got deleted. Caught by
  the integration test below (a 65-second polling test, not a quick assert),
  fixed by computing `expiresAt` inside SQLite itself
  (`datetime('now', '+N seconds')`) so both sides of the comparison are
  guaranteed the same format. Also fixed the client's local countdown to
  apply the same `"T"+"Z"` fixup already established in `lib/utils.ts`'s
  `formatTime` for this exact SQLite-format-vs-JS-Date-parsing mismatch —
  otherwise a browser not in UTC would remove messages at the wrong moment.
- **Verified with a real integration test** (`/tmp/e2ee_test/phase5_test.mjs`,
  not part of the shipped repo) against a live server — 15 assertions, all
  passing, including:
  - Timer changes propagate to both participants over real Socket.IO
  - A new message's `expiresAt` lands within the expected window
  - The conversation history endpoint reports the current timer setting
  - The message is genuinely gone (not just hidden) from history after
    expiry, confirmed by polling every 5s for up to 65s real wall-clock time
  - Both participants receive `message_expired`
  - Sender cannot consume a view-once attachment (403); only the receiver
    can (200); a second consume attempt correctly 410s; consuming a
    non-view-once attachment is rejected (400); post-consumption, *neither*
    party can download it anymore (410 for both)
- Both client and server typecheck and build cleanly with Phase 5 included.
- **Not yet verified in a browser**: the disappearing-timer picker menu, the
  view-once toggle button, and the tap-to-reveal UI are build-verified only,
  not click-tested — no browser is available in this environment. The
  underlying timer/consumption logic is proven live against a real server;
  the UI wiring is not.

## Phase 6 — Chat Lock (backend done and verified; client build-verified only)

- **PIN model**: one PIN per account (bcrypt-hashed, cost 12, never stored
  raw), gating whichever conversations that account has personally locked.
  Locking is per-user, not shared — matches WhatsApp's Chat Lock: the other
  participant's view of the conversation, and their ability to message into
  it, is completely unaffected by your locking it.
- **Brute-force protection, two layers**: a dedicated IP-based rate limiter
  (`chatLockVerifyLimiter`, stricter than the general settings limiter) plus
  a DB-backed exponential lockout after 5 wrong attempts, because a 4-8
  digit PIN has far less entropy than a password and needs defense beyond
  just IP throttling.
- **Server-side enforcement of "avoid exposing message previews"**: the
  conversations-list endpoint redacts `content`/`ciphertext` to empty/null
  for any conversation the requesting user has locked — this is enforced
  server-side, not left to the client to hide cosmetically. Notifications
  for a locked conversation say "New message" with no sender name.
- **Client**: `hooks/useChatLock.tsx` (React context: PIN status, an
  in-memory-only `sessionUnlocked` flag that intentionally resets on reload
  — persisting it anywhere would defeat the feature), `ChatLockPrompt.tsx`
  (PIN-entry modal, reused for both "view locked chats" and "unlock/remove
  a specific conversation's lock"), a lock/unlock toggle in the `ChatWindow`
  header, a "Locked chats" section in `ChatList` that hides behind the
  prompt, and a Chat Lock section in Settings for PIN setup/change/removal.
- **Caught while building this phase**: proactively re-checked the exact
  SQLite-datetime-string-format bug found in Phase 5 (see above) against the
  new lockout-expiry comparison here — got the UTC "T"+"Z" fixup right on
  the first pass this time instead of finding it the hard way again.
- **Also fixed in passing**: the client's password-change form was still
  validating against a 6-character minimum from before Phase 1 raised the
  server's requirement to 8 — found while working in the same Settings file
  and corrected it.
- **Verified with a real integration test** (`/tmp/e2ee_test/phase6_test.mjs`,
  not part of the shipped repo) — 20 assertions across 15 scenarios, all
  passing: PIN set/change/remove with correct-current-PIN enforcement,
  locking blocked until a PIN exists, the 5-attempt lockout actually
  triggers (and blocks even a subsequently-correct PIN during the lockout
  window), chat-list redaction confirmed via a real encrypted message sent
  over Socket.IO, notification sender-name suppression confirmed the same
  way, unlock rejected on wrong PIN, and PIN removal cascading to clear
  every lock.
- Both client and server typecheck and build cleanly with Phase 6 included.
- **Not yet verified in a browser**: the PIN-entry modal, the locked-chats
  list section, and the Settings PIN form are build-verified only — no
  browser available in this environment.
- **Deliberately not attempted**: "biometric/passkey integration" from the
  original spec. A real WebAuthn implementation needs a full registration/
  attestation ceremony, and unlike everything else built so far, it is
  fundamentally impossible to verify in this sandbox — it requires actual
  platform authenticator hardware. Better built properly under Phase 12
  (Account Security, which already calls for passkeys) than rushed and
  unverified here.

### Explicitly NOT started (of the 30-phase transformation plan)
Notification-content privacy settings UI (the per-account "message previews"
toggle already exists in Settings from before this transformation — a
dedicated notification privacy center is still not built), messaging-quality
polish beyond what already existed, calling/TURN work,
2FA/passkeys/recovery codes, privacy center UI, groups + group encryption,
group calls/SFU, the performance/mobile/accessibility/error-handling/
offline passes, structured logging, the automated test suite, and the
README/SECURITY.md documentation pass.

---
*The "Phase 3"/"Phase 4" headings immediately below are leftover from this
project's original pre-transformation roadmap and use different numbering
than the 30-phase transformation plan tracked above — don't confuse the two.*

## Phase 3 — Private messaging features
- Disappearing messages
- View-once media
- Voice messages
- Encrypted files/media
- Chat lock
- Notification privacy enforcement
- Device/session management

## Phase 4 — Sakhya differentiators
- Private connection spaces
- Shared encrypted memories
- Shared notes
- Favorites/pinned moments
