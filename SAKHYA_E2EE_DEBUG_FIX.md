# Sakhya E2EE MAC / Ratchet Debug Fix

## Root cause

`OLM.BAD_MESSAGE_MAC` was occurring when the browser had a persisted Olm session for a sender device, but the sender had established a newer session (for example after reinstalling, clearing browser storage, or recovering onto a new browser state). The decryptor previously trusted the persisted session unconditionally. A new type-0 PreKey message could therefore be fed into the old ratchet and fail MAC validation instead of replacing the stale session.

This is a cryptographic session-state synchronization problem, not a React/Next.js rendering problem.

## Fixes

- When a type-0 message fails against an existing session with a session/MAC/key-id error, the stale session is discarded and the inbound Olm session is rebuilt from the type-0 message.
- Type-1 messages are never blindly re-keyed; without a valid session they remain undecryptable rather than weakening the protocol.
- Older paginated history is now passed through the same sequential E2EE decryptor before entering the chat state.
- Encrypted edits invalidate the old plaintext cache before decrypting the new ciphertext.
- Existing per-user crypto locking remains in place so a single Olm account/session cannot be mutated concurrently across supported browser tabs.

## Important runtime test

For a complete two-browser validation, send messages in both directions, reload both browsers, create a second device/browser session, send again, revoke a device, and verify that each active device receives/decrypts only its own envelope. Also test sender reinstall/session reset because that is the state transition that previously exposed the MAC failure.
