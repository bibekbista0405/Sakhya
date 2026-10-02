# Sakhya E2EE Root-Cause Fix

## Root cause

Sakhya uses Olm sessions, which are forward-ratcheting and stateful. A ciphertext is not an independently decryptable database record: decrypting one message advances the session. The previous history loader treated paginated server history as if every message could be decrypted independently.

This caused several failure modes:

- reopening a chat after the live session had advanced could try to decrypt older ciphertext with a later ratchet state;
- loading an older pagination page could try to decrypt messages older than the current session state;
- a type-0 message could arrive while a newer persistent session already existed, and the previous recovery path could destroy the persistent state before proving that the replacement session was valid;
- the UI logged every expected forward-ratchet/history mismatch as `OLM.BAD_MESSAGE_MAC` or `OLM.BAD_MESSAGE_KEY_ID`.

## Fix

The history path now decrypts a chronological batch while holding the existing crypto lock and keeps one in-memory Olm session per sender-device. If a type-0 message proves that a new session is needed, a replacement session is tested first. A newer persistent live session is never overwritten by a replayed history session.

Newly established sessions are persisted only when they are safe to continue from the batch. Existing persistent sessions are persisted at their newly reached ratchet position unless the batch had to replace them, in which case the newer persistent state is preserved.

Messages that are genuinely older than the available forward-secret session and have no local plaintext cache are reported as unavailable on that device instead of repeatedly throwing MAC/key-id errors. This does not weaken E2EE or expose plaintext to the server.

## Important E2EE limitation

Olm forward secrecy means a brand-new device cannot magically decrypt arbitrary historical ciphertext for which it has never possessed the corresponding session state/message keys. Cross-device history recovery requires an explicit end-to-end history/key-transfer protocol; it cannot safely be solved by retrying the same ciphertext with a different current ratchet.
