# Sakhya Phase 9 — Calls & Real-Time Communication

## Phase 8 recheck

- Verified encrypted voice messages remain on the existing client-side AES-256-GCM attachment path.
- Verified voice metadata is protected by the existing Olm E2EE message path.
- Verified microphone capture is cleaned up on cancel, send, permission failure, and component/provider cleanup.
- Verified the existing friends-only attachment authorization and view-once handling remain unchanged.
- No Phase 8 crypto boundary was changed during the call work.

## Phase 9 call lifecycle

- Audio and video calls use the existing WebRTC peer-connection implementation.
- Caller lifecycle: calling → WebRTC connection → connected, or declined/failed/no-answer.
- Callee lifecycle: ringing → accepted → WebRTC connection → connected, or rejected/no-answer.
- Duplicate and late signaling is ignored by `callId`.
- A second simultaneous call is rejected when either participant is already in an active call.
- ICE candidates are buffered until the remote description is available.
- Microphone/camera tracks are stopped when a call ends or fails.
- 30-second client connection timeout remains in place; server-side unanswered calls expire after 45 seconds.
- Audio and video controls remain available during connected calls.
- Call duration starts only after the peer connection reaches the connected state.

## Signaling and security recheck

- SDP and ICE payload limits from Phase 4 remain enforced server-side.
- Call signaling remains rate-limited independently from normal chat messages.
- `call_user` now requires an SDP offer rather than accepting an answer-shaped payload.
- Calls still require friendship and respect blocking rules.
- The server does not relay plaintext call media; WebRTC carries the media between peers.
- STUN remains available by default and optional TURN configuration remains supported through the existing environment variables.

## Reliability fixes added in Phase 9

- Missed-call timeout now creates a persistent missed-call notification for the callee, not only a call-history row.
- Active calls are bound to the exact caller/callee WebSocket that owns the WebRTC peer connection. Disconnecting an unrelated account socket no longer tears down the call.
- The accepting socket is recorded when a call is accepted, so multi-tab/account-session behavior is deterministic.
- Existing call history is preserved through `/api/calls` and continues to show audio/video type, direction, status, duration, and other participant.

## Validation

- Phase 8 source and documentation were rechecked before Phase 9 changes.
- Server call-signaling code was statically reviewed after modification.
- Full dependency-backed client/server build remains dependent on installing the ZIP's npm dependencies; the supplied project does not include `node_modules`.
- No changes were made to the E2EE message/attachment crypto implementation for Phase 9.
