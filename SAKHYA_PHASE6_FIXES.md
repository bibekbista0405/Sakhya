# Sakhya Phase 6 — Account, Device & E2EE Reliability Hardening

## Root cause of first-click delay

Authentication previously awaited browser-side libolm initialization, IndexedDB access, key generation and `/devices/register` before routing to `/chats`. On a fresh device this could make the first interaction appear frozen for seconds. Phase 6 makes E2EE registration background work; encryption/decryption still await it when cryptography is actually required.

## E2EE fixes re-audited

- Authentication navigation no longer waits for E2EE registration.
- Existing account-scoped Olm state remains isolated in IndexedDB.
- One-time-key generation/top-up remains serialized through the crypto lock.
- Multi-device fan-out continues to create one Olm ciphertext per active recipient/own device.
- Sender device ownership is enforced by the server; when a session is already bound to a crypto device, another device cannot spoof the sender device ID.
- Revoked device identities can no longer be resurrected. The server returns 409 and the client creates a fresh identity.
- Session schema now includes `deviceId` so crypto-device revocation can invalidate the associated login session.
- Legacy session migrations safely handle databases where the old `deviceId` column does not exist.
- Attachment download/consume now respects current friendship/block state.

## E2EE lifecycle checked

1. Account-scoped Olm identity creation/persistence.
2. Device registration and prekey publication.
3. Atomic server-side one-time-key claiming.
4. Olm session establishment and ratchet persistence.
5. Multi-device encrypted envelopes.
6. Inbound PreKey session creation and one-time-key removal.
7. Identity TOFU pinning/change detection.
8. Disappearing/view-once plaintext cleanup from earlier phases.
9. Device revocation and session invalidation.
10. Background prekey replenishment.

A full production build/runtime interoperability test still requires installing the project's dependencies and running two authenticated browser clients against the server; this environment does not contain `node_modules`, so those runtime claims are not represented as completed tests.
