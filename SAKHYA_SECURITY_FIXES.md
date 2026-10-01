# Sakhya security/correctness fixes applied

This patch preserves the existing Sakhya architecture and UI.

## Fixed

1. **Public profile privacy**
   - Public user serialization no longer exposes email, date of birth, or gender.
   - Self/auth/profile responses use a private serializer so the logged-in user still receives their own account fields.

2. **One-time prekey race**
   - Prekey claiming now uses a conditional `UPDATE ... WHERE claimedAt IS NULL` and checks the affected-row count.
   - Concurrent requests cannot both successfully claim the same one-time prekey.

3. **Prekey over-consumption**
   - Bundle requests now target the exact recipient device being initialized.
   - A single bundle request no longer consumes one prekey from every active device.

4. **Outgoing encrypted-message correlation**
   - Replaced FIFO plaintext matching with an ephemeral `clientMessageId` map.
   - Server echoes the ID only to the sending socket.
   - Rejected sends remove the exact pending plaintext, preventing a later message from displaying the wrong text.
   - Socket errors are scoped to the intended chat.

5. **Sender-device validation**
   - Encrypted messages are accepted only when `senderDeviceId` belongs to the authenticated user and is not revoked.

6. **Multi-device E2EE fan-out**
   - Added `message_envelopes`, storing one Olm ciphertext per active recipient device while keeping one logical message row.
   - Outgoing messages are independently encrypted for every active recipient device and for the sender's other active devices.
   - Recipient devices select only their own envelope during local decryption.
   - Trust pins are now device-specific.

7. **Multi-device edit/delete consistency**
   - Encrypted edits replace all per-device envelopes atomically.
   - "Delete for everyone" removes all encrypted envelopes as well as the legacy primary ciphertext.

## Remaining work

The next security phase is disappearing-message/local-plaintext cleanup, followed by WebRTC/TURN hardening, session/API hardening, and integration testing.

## Validation note

The source was statically checked with the available TypeScript compiler. Full dependency-backed build verification could not be completed in this environment because `npm install` timed out and the extracted project did not contain installed dependencies.
