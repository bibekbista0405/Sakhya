# Sakhya Phase 3 — Disappearing Messages & Local Plaintext Privacy

## Completed

### 1. Expired-message plaintext cleanup
When the server emits `message_expired`, the client now deletes the corresponding decrypted plaintext from account-scoped IndexedDB as well as removing it from the rendered/chat cache.

### 2. Background expiry cleanup
The notification/socket provider listens for `message_expired`, so plaintext is removed even when the affected conversation is not currently open.

### 3. Local countdown cleanup
The chat's local expiry timer now deletes IndexedDB plaintext for every message whose expiry has elapsed instead of only hiding it from the UI.

### 4. Delete-for-everyone cleanup
When a deleted message is received/processed, its cached plaintext is removed before the message is rendered as empty.

### 5. Delete-for-me cleanup
The existing `message_hidden` path now also removes the message's local decrypted plaintext.

### 6. Clear-chat cleanup
Clearing a conversation removes its rendered cache and deletes the local decrypted plaintext for every message currently known in that chat.

### 7. Logout privacy boundary
Logout now clears all decrypted message/attachment plaintext from the current account's IndexedDB namespace and clears the in-memory chat cache. Long-lived E2EE identity keys remain intact so normal device identity/session behavior is preserved.

### 8. View-once lifecycle
A recipient now claims server-side consumption before the decrypted object URL is exposed in the UI. The local plaintext is then replaced with a keyless consumed marker so the attachment cannot be reconstructed from the cached metadata.

## Important E2EE limitation
A view-once guarantee cannot be made absolute against a modified/untrusted client: once encrypted content is decrypted, that client can copy the plaintext bytes. Sakhya's server-side guarantee is that, after successful consumption, the server-side ciphertext is no longer downloadable.

## Validation
The modified TypeScript/TSX files were syntax/transpile-checked successfully with TypeScript 5.8.3. A full dependency-backed build could not be run in this environment because `npm install` timed out and the project ZIP does not contain `node_modules`.
