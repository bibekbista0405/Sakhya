# Sakhya Phase 4 — Calling / WebRTC Hardening

Implemented without replacing the existing call UI or signaling model.

## Server
- Added a 256 KiB Socket.IO transport payload ceiling.
- Added SDP validation and a 64 KiB SDP limit.
- Added ICE candidate validation and an 8 KiB candidate limit.
- Added dedicated per-user WebRTC signaling rate limiting.
- Validated call answers as actual SDP answers before relaying.
- Preserved friendship/block/busy authorization checks.
- Continued expiring unanswered calls and cleaned signaling-rate state periodically.

## Client
- Explicitly rejects a second incoming call while another call is active.
- Ignores late `call_rejected` / `call_ended` events belonging to another call.
- Treats ICE `failed` as terminal while allowing transient `disconnected` state to recover.
- Clears call timing state during teardown.
- Existing STUN + optional TURN configuration remains intact.

## Important production note
TURN is still required for reliable connectivity across restrictive NATs/firewalls. The project already supports configuring a TURN server through `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL`; no public TURN credentials are embedded in source.
