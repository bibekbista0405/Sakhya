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

## Real-world runtime fixes (found by actually running the app locally)

Everything above this section was verified in this sandbox via typecheck,
build, and Node-script integration tests against a live server — but none
of it had ever run in an actual browser, which I flagged repeatedly as a
real gap. The person running this project locally hit a genuine crash,
diagnosed and fixed it themselves, and in the process found and fixed
several more bugs that only show up under real browser/runtime conditions.
Their fixes were reviewed and merged in, and re-verified against every
existing integration test plus new ones for the previously-untested pieces.
None of this was invented or assumed — each item below was confirmed by
re-running the actual test suite after merging.

- **The triggering crash**: `next dev` was running with `--turbopack`, which
  ignores `next.config.ts`'s webpack `resolve.fallback` — so `@matrix-org/olm`'s
  UMD build tried to `require("fs")`/`require("path")` (it auto-detects
  Node vs. browser, and gets fooled by Next.js's `process` polyfill) and
  crashed the entire app with a 500 on every page. Fixed by dropping
  `--turbopack` from the dev script and making the webpack fallback apply
  unconditionally (it previously only covered the client bundle, missing
  the SSR bundle where the same error also occurred).
- **E2EE identity not scoped per account**: the IndexedDB store holding Olm
  keys and sessions was global to the browser, not namespaced per logged-in
  user — two Sakhya accounts used in the same browser would have silently
  shared one device identity, breaking encryption in a way that would be
  very confusing to debug. Fixed by scoping the IndexedDB database name to
  the authenticated user's ID.
- **Device-registration race on login**: `ensureDeviceRegistered()` was
  fired-and-forgotten (not awaited) before navigating to the chat list, so
  the very first message sent right after login/register could race the
  key-upload request and fail. Fixed by awaiting it (and passing the known
  user ID directly, closing a second race where `useAuth`'s own state
  hadn't updated yet).
- **Live messages could arrive mid-history-load**: if a message arrived over
  the socket while the initial chat-history decrypt was still in progress,
  it could be processed out of order relative to the Olm ratchet, since
  Double Ratchet decryption is order-sensitive. Fixed with a gate that holds
  live messages until history hydration finishes, plus an `AbortController`
  so switching chats quickly cancels the now-irrelevant in-flight load
  instead of racing it.
- **A real authorization gap in calling** (pre-existing code from before
  this transformation, not something I had touched in Phases 1-6): call
  accept/reject/end and ICE-candidate relaying never checked that the
  socket emitting the event was actually a participant in that call. I
  wrote a fresh test for this (not part of the original fix) with a third,
  uninvolved user attempting to accept, inject an ICE candidate into, and
  end a call between two other users — all three were correctly rejected
  after the fix, confirmed live.
- **Socket sessions were only checked at handshake, not per-event**: same
  class of bug as the Phase 1 session-invalidation fix, one layer deeper —
  a revoked session or password change didn't disconnect an already-open
  socket until it happened to reconnect. Fixed with per-packet
  revalidation. Also wrote a fresh test: logged out a connected user and
  confirmed their socket was force-disconnected and a subsequent event from
  it had no effect.
- **Typing indicators and read receipts ignored privacy settings
  server-side**: the toggles existed in `privacy_settings` from before this
  transformation, but the server relayed these events regardless. Now
  enforced server-side, not just trusted to the client.
- Smaller fixes: attachment size validation didn't account for AES-GCM's
  16-byte authentication tag overhead (could reject legitimate near-limit
  files); view-once consumption had a check-then-act race allowing a
  double-consume under concurrent requests, now atomic; a stale 6-character
  password minimum remained on the client after Phase 1 raised the server's
  requirement to 8.
- **Tooling fix found while merging, not in the original fix**: the merge
  paired `eslint-config-next@15.5.25` with the project's flat-config
  `eslint.config.mjs`, but that config shape (`import x from
  "eslint-config-next/core-web-vitals"` spread as an array) only works with
  eslint-config-next's 16.x line — 15.x still exports the legacy
  `{ extends: [...] }` shape. The build was silently succeeding with a
  broken lint step. Rewrote `eslint.config.mjs` to use Next's own
  `FlatCompat` bridge, the correct pattern for the 15.x line; `next build`
  now lints cleanly with zero errors or warnings.
- **The "too many requests" problem**: separately reported, not part of the
  merged fix. All rate limits (`middleware/rateLimit.ts` and the per-socket
  message limiter) now scale by 20x automatically whenever
  `NODE_ENV !== "production"`, so local testing — repeated registration,
  login attempts, Chat Lock PIN entry — won't hit production-tuned lockouts.
  Production behavior is completely unchanged.
- **Post-merge verification**: re-ran every existing integration test
  (Phases 2, 4, 5, 6 — E2EE round-trip, all attachment tests, disappearing
  messages + view-once, chat lock) against the fully merged codebase; all
  passed unchanged. Wrote and ran new tests for the call-authorization and
  per-packet session-revalidation fixes specifically, since those were new
  claims I hadn't verified myself. Both client and server typecheck and
  build with zero errors and zero warnings.

## Phase 7 — Notification privacy (done and verified)

- **Replaced the old unused `messagePreview` boolean** (present in the
  schema from before this transformation, but never actually enforced
  anywhere — confirmed while auditing for this phase) with a real 4-level
  `notificationContentLevel`: `full` / `sender` / `generic` / `hidden`,
  migrated from the old flag on upgrade.
- **Honest limit on "full"**: it only actually applies to legacy plaintext
  messages. The server never has plaintext for an E2EE message regardless
  of this setting, so it degrades to `sender`-level text for those — this
  is stated in the code and the Settings UI copy, not glossed over.
- **Lock-aware floor, not override**: the level actually applied to a given
  notification is the *more restrictive* of the recipient's global
  preference and "generic" if they've locked that specific conversation
  (Phase 6). Locking a chat can only make its notifications more private,
  never less — even a `hidden` global setting stays `hidden` when locked
  (locking doesn't loosen anything).
- **`hidden` skips creating a notification row entirely** — confirmed via
  the notifications-list endpoint, not just "the client doesn't show it."
  Unread badges are unaffected since those come from the messages table
  directly, not the notifications table.
- **Client-side enhancement using existing infrastructure**: when the
  user's preference is `full` but the server had to degrade an encrypted
  message to sender-only text, the live socket event carries a transient
  `upgradableToFull` flag (never persisted — only present on the live
  event, not in notification history). The client checks its own local
  decrypted-message cache (the same one built in Phase 2) and upgrades the
  notification body only if it already has the plaintext AND the
  conversation isn't locked client-side too, as defense in depth on top of
  the server's own floor.
- **Real Web Notifications API integration** (`lib/browserNotifications.ts`):
  requires an explicit user gesture to request permission (Settings has a
  button; browsers block silent permission requests anyway), only shows a
  notification when the tab is hidden/unfocused, click-to-navigate to the
  right conversation, auto-close, and a logout cleanup that closes anything
  still on-screen. Documented honestly in the code: this only works while a
  tab is open somewhere — there's no push-service/service-worker setup, so
  nothing arrives if the browser is fully closed.
- **A provider-ordering bug caught before it could ship**: the new
  `NotificationProvider` needed `useChatLock`, which requires it to sit
  inside `ChatLockProvider` in the layout tree — it didn't, which would
  have crashed immediately. Fixed and confirmed via a clean build (this is
  exactly the class of bug that only surfaces at build/runtime, not
  typecheck — another data point for why build-verification matters).
- **Verified with a real integration test** (`/tmp/e2ee_test/phase7_test.mjs`,
  not part of the shipped repo) against a live server — 8 assertions, all
  passing: default level behavior, `generic` and `hidden` levels, `full` on
  both legacy and encrypted messages (confirming the honest degradation and
  the `upgradableToFull`/`senderId` flags), and both directions of the
  lock-floor interaction (a permissive global setting gets floored by
  locking; a stricter global setting is never loosened by locking).
- Both client and server typecheck and build with zero errors and zero
  warnings (confirmed via a full `next build`, not just `tsc --noEmit`,
  learning from the Turbopack incident that typecheck alone doesn't
  guarantee a working build).

### Phase 7 bug-check pass (requested separately, after initial completion)
Went back through Phase 7 specifically looking for issues rather than
assuming the passing tests meant it was clean. Found and fixed two real
problems:
- **A genuine stale-closure bug** in `useNotifications.tsx`: the socket
  listener effect only depended on `[socket]`, but its handler called
  `showForNotification`, which closed over `chatLock` and `router` from
  that render. Since `socket` rarely changes once connected, that closure
  would freeze at whatever `chatLock` was when the socket first connected —
  almost certainly before the lock list even finished its first fetch,
  meaning the "don't upgrade notifications for locked chats" defense-in-depth
  check could silently never see real lock state for the rest of the
  session. This is the same class of bug the merge fixed in `ChatWindow.tsx`
  (missing `user` dependency) — I introduced a fresh instance of it in
  Phase 7 without noticing, which is exactly why a dedicated recheck was
  worth doing rather than trusting the passing integration tests alone
  (they test server behavior; this bug was entirely client-side state
  timing, invisible to a Node test script). Fixed with refs kept fresh on
  every render, avoiding both the staleness and the cost of re-subscribing
  the socket listener on every chat-lock change.
- **Dead code**: `setNotificationContentLevel` in `db/index.ts` was never
  actually called — `routes/privacy.ts` writes the column directly with its
  own SQL. Not a functional bug (the feature works, tests passed either
  way), but two write paths to the same column is exactly the kind of thing
  that causes real bugs later when only one gets updated during a future
  change. Removed the dead one. Worth noting: TypeScript's `tsc --noEmit`
  does not flag unused exports the way it flags unused local variables, so
  this kind of duplication doesn't show up in a typecheck — it needed an
  actual read-through to catch.
- Re-ran the full Phase 7 integration test suite after both fixes: all 8
  assertions still pass. Also re-ran a full `next build` (not just
  typecheck) to confirm the ref-based fix didn't introduce anything the
  build would catch.

## Full project re-audit (requested separately, across every phase)

Went back through Phases 1-7 end to end specifically hunting for bugs,
rather than trusting that passing tests meant the code was clean. This is
different from the Phase 7-only recheck above — this pass covered the
entire codebase. Found and fixed four more real issues, then re-ran every
existing integration test (Phases 2, 4, 5, 6, 7, plus the merge-security
tests) against the fully fixed codebase — all still pass, with zero
regressions.

- **A real, previously-unnoticed datetime bug in `purgeExpiredSessions()`**
  (Phase 1): the exact same bug class as the Phase 5 message-expiry bug,
  in code that predated Phase 5 and was never rechecked once that bug class
  was understood. Sessions' `expiresAt` is written as a JS
  `Date.toISOString()` string (`...T...Z`), but the sweep compared it
  directly against SQLite's `datetime('now')` format (space-separated, no
  `T`/`Z`) as a plain string. Proved it two ways: a standalone script showed
  the old query found 0 expired sessions when 1 genuinely-expired one was
  present, and after the fix (wrapping both sides in SQLite's own
  `datetime()`, which correctly parses ISO 8601 input) it found exactly the
  right one. **Impact was data hygiene, not a security hole** — `requireAuth`
  and the socket auth middleware independently re-check expiry via proper
  `Date` arithmetic on every request, so an unswept expired session was
  never actually usable. But the `sessions` table would have accumulated
  expired rows indefinitely, contrary to what the function's own comment
  claimed it did.
- **A real race condition plus dead code, both in one function**
  (`maybeTopUpOneTimeKeys` in `lib/crypto.ts`, Phase 2): this function
  mutates the same shared in-memory Olm account object that
  `encryptForPeer`/`decryptFromPeer` use, but unlike those two, it wasn't
  wrapped in the crypto lock the merge introduced — a concurrent call could
  lose an update to the persisted account state, which for Olm specifically
  risks losing track of which one-time keys were already consumed (a real
  forward-secrecy concern, not just a generic race). Separately, and more
  simply: **the function was never called from anywhere in the app.**
  One-time prekeys would only ever be consumed, never replenished, meaning
  a device's prekey pool would silently exhaust over time and new incoming
  sessions would have to fall back to the signed fallback key indefinitely.
  Fixed the race by wrapping it in the same lock, and wired it up: it now
  runs once shortly after login and every 15 minutes while signed in.
- **A real account-isolation gap on logout** (Phase 2): the whole point of
  the merge's per-account IndexedDB scoping was that one browser can safely
  hold two different Sakhya accounts' encryption state. But nothing ever
  reset the "active account" pointer on logout — it only got updated the
  next time a *different* user's ID was passed to device registration.
  Between logout and the next login, the crypto module's notion of "current
  user" stayed pointed at whoever just logged out. Not an active security
  hole (the auth token is already cleared, so a stray authenticated call
  would just fail), but a real correctness gap in a feature whose entire
  purpose is isolation. Added `clearActiveCryptoSession()` and wired it into
  logout.
- **Systematically re-checked every other `useEffect` with a suppressed
  `exhaustive-deps` warning** across the client (there were only two: the
  one already fixed in the Phase 7 recheck, and one in `MessageBubble.tsx`)
  — traced through the second one by hand and confirmed it's actually safe:
  the only prop fields its effect body reads are fixed for the lifetime of
  a given `attachmentId`, so the narrower dependency array doesn't cause
  staleness in practice. Documented as checked, not just assumed.
- **Re-verified, not just re-read, several areas that turned out fine**:
  the calling code's main socket-listener effect correctly includes `phase`
  in its dependency array (the one state value it actually reads directly)
  and uses refs for everything else — no bug found. The view-once atomic
  consume fix from the merge is correctly race-free. The dynamic SQL
  `IN (...)` clause in the device-listing route correctly handles the
  empty-array case. The per-packet socket session-revalidation middleware
  correctly re-queries on every incoming event with the right (JS-ISO)
  format. Chat Lock's client-side gating is a deliberate, documented design
  choice (matching how WhatsApp's Chat Lock also works) rather than an
  oversight — the server intentionally doesn't enforce it as a true ACL
  since it's the account's own data.
- **One drift risk noted but not changed**: the client hardcodes its
  attachment size limit (25MB) rather than reading the server's actual
  configured `MAX_ATTACHMENT_MB`. Both layers still correctly enforce *a*
  cap either way, so this isn't a functional bug — just something that
  could show a slightly wrong client-side error message if a deployment
  customizes the server's limit away from the default.
- **Full re-verification after all fixes**: both client and server
  typecheck and build with zero errors and zero warnings. Every existing
  integration test suite was re-run from scratch against the fixed
  codebase — E2EE round-trip, all attachment tests, disappearing messages +
  view-once, chat lock (all 20 assertions), notification privacy (all 8
  assertions), and the call-authorization/session-revalidation tests. All
  passed, unchanged.

## Phase 8 — Messaging quality (partially done, what's built is verified)

Much of this phase already existed before this transformation (reply, edit,
reactions, typing indicators, delivered/seen) — audited what was actually
present before building anything, rather than assuming the phase list meant
starting from zero.

**Built and verified:**
- **"Delete for me"**: didn't exist at all before — only sender-only
  "delete for everyone" was implemented. Added as a genuinely per-viewer
  hide via a `deleted_for_user` table, filtered directly into the message-
  history SQL query (not a post-fetch filter, which would have silently
  broken the `hasMore` pagination flag — checked for that specifically and
  confirmed correct with a paginated test).
- **Starred messages**: new per-user feature end to end — server table,
  socket events, a dedicated `GET /api/messages/starred` endpoint (had to
  register it *before* the `/:friendId` wildcard route in Express or it
  would have been swallowed as a friend ID), a star toggle in the message
  menu, and a new `/starred` page that decrypts and lists starred messages
  across every conversation. Added a Settings link to it rather than a new
  primary nav tab — both the desktop and mobile nav bars were already at
  their intended tab count.
- **Date separators** and an **unread-messages divider** in the chat view,
  the divider computed from each message's pre-fetch `status` (captured
  before the server's own read-receipt update overwrites it in the same
  request) so it reflects genuinely-unread state, not a guess.
- **Click-to-jump on a reply preview**: scrolls to and briefly highlights
  the original message if it's in the currently-loaded page of history;
  intentionally no-ops rather than erroring if the replied-to message
  hasn't been paged in yet.
- **Verified with a real integration test** — 12 assertions, all passing:
  delete-for-me confirmed to affect only the requester's view (the other
  participant's history is untouched); pagination correctness with hidden
  messages mixed into a result page; starring confirmed genuinely per-user
  (one person starring a message doesn't star it for the other participant);
  and a third party can neither hide nor star a message they're not part of.
- One test bug caught in myself during this pass: my first run of the
  delete-for-me test crashed because I'd fetched "Bob's history" using
  Bob's own user ID as the friendId parameter instead of Alice's — the
  server correctly rejected it (you can't be friends with yourself). Not an
  app bug; fixed the test and reran clean.
- Both client and server typecheck and build with zero errors and zero
  warnings; the full existing test suite (E2EE, attachments, disappearing
  messages, chat lock, notifications, call auth) was re-run after these
  changes landed — no regressions.

**Deliberately not attempted in this pass** — each is substantial enough to
deserve its own focused effort rather than being rushed in alongside
everything above:
- **Voice messages** (recording, waveform visualization, pause/resume) —
  needs the MediaRecorder API, a waveform renderer, and careful integration
  with the existing encrypted-attachment pipeline from Phase 4.
- **Media gallery / shared files / shared links panel** — this overlaps
  directly with Phase 9's "Chat Info" page, which doesn't exist yet; better
  built together as one coherent panel than as two separate half-features.
- **Full-history message search** — current search only filters messages
  already loaded into the client (up to the current pagination window).
  Worth noting explicitly: genuine server-side full-text search is not just
  "not built yet" but architecturally impossible here in the way a
  non-encrypted app could do it — the server never has plaintext to search
  for encrypted conversations. A real fix would mean a client-side search
  index built up progressively as messages get decrypted (the plaintext
  cache from Phase 2 already provides the raw material for this), which is
  a real feature worth building, not a shortcut to fake.
- **Pinned messages** as a distinct concept from starring — arguably
  redundant with starring for a 1:1 messenger (pinning matters more for
  groups, which don't exist yet either), so deferred rather than building a
  second, overlapping "important message" mechanism.

## Phase 9 — Chat Info & Media (done and verified)

**A mid-phase incident worth recording honestly**: partway through building
this phase, the sandbox environment's filesystem was reset — everything
under `/home/claude` and `/tmp`, including all in-progress work and test
scripts, was gone without warning. The last successfully *delivered and
packaged* zip (end of Phase 8) survived, since outputs are stored
separately from the working container. Every Phase 9 change described below
was rebuilt from that recovery point — the backend re-verified against the
same integration test, rewritten from scratch, with all 17 assertions
passing exactly as before the reset. Noting this because "I tested this
already" stops being trustworthy the moment the environment can silently
disappear out from under a session — what matters is that it was re-proven
after recovery, not merely reconstructed from memory of having done it once.

- **A second real, previously-unenforced privacy bug**, found while wiring
  up "online/last seen" for this phase: `privacy_settings.onlineStatus` has
  existed in the schema and the Settings API since before this
  transformation, but — like `messagePreview` in Phase 7 — nothing ever
  actually checked it. Every place that exposed `online: isUserOnline(id)`
  did so unconditionally, including the live Socket.IO presence broadcast
  and the initial `online_users` snapshot sent on connect, not just REST
  responses. Fixed all of it, not just the obvious REST case: a fix that
  only covered the profile endpoint would have still leaked real-time
  presence over the socket. Verified live: toggled the setting mid-test on
  a genuinely-still-connected user and confirmed both the REST view and a
  live reconnect event correctly showed them offline to a friend.
- **Last seen**, properly respecting the pre-existing (and, per the pattern
  above, previously also just cosmetic) `lastSeenVisibility` setting.
  Tested both the "hidden" and "visible to a friend" paths explicitly,
  not just one of them.
- **Mute**, confirmed to override even the most permissive notification
  setting (`full`) — verified that specific ordering rather than assuming
  "stronger setting wins" behaves correctly by default.
- **Report**: reason validation, self-report blocked, stores for review.
  No moderation/admin UI exists in this codebase — this only records the
  report.
- **Media gallery, built around a real architectural constraint rather than
  faking it**: the server can tell a message has an attachment (via the
  attachments table's link) but never what kind — that's inside content it
  never has plaintext for. `GET /messages/:friendId/media` returns the raw
  attachment-bearing message feed; the client decrypts each one and sorts
  into images/videos vs. files itself. Confirmed the feed correctly
  excludes plain-text messages from the count.
- **Links tab**: also necessarily client-side-only, for the same reason —
  a URL inside encrypted message text is invisible to the server. Scoped
  honestly to "links found in whatever conversation history is currently
  loaded," not presented as a complete archive.
- **Clear chat / delete conversation**: confirmed to be the same underlying
  bulk "delete for me" operation, and confirmed — again — that it only
  ever affects the requester's own view. The other participant's full
  history remained completely intact in the test after the requester
  cleared their side.
- Both client and server typecheck and build with zero errors and zero
  warnings. The full backend integration test (17 assertions covering
  online-status enforcement in three different places, last-seen
  visibility in both directions, mute-overrides-permissive-setting,
  report validation, media-feed filtering, and clear/delete isolation) was
  re-run after the environment reset and passed unchanged.
- **Not independently re-verified after the reset**: the client-side Chat
  Info panel, media gallery grid, and links tab are rebuilt exactly as
  designed and pass typecheck + full production build, but — consistent
  with every UI-touching phase in this project — have not been click-tested
  in an actual browser.

### Explicitly NOT started (of the 30-phase transformation plan)
Voice messages (see Phase 8 notes above for why scoped out), general messaging-quality
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
