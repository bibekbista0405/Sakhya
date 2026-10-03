# Sakhya Phase 8 — Encrypted Media & Voice Messages

## Phase 7 regression check

- Rechecked the Phase 7 People/friend-request flow before modifying media code.
- Existing friend-request send/accept/reject state handling remains intact.
- Acceptance continues to route the relevant user into the chat flow.

## Phase 8 changes

### Encrypted voice messages
- Added browser-native `MediaRecorder` voice capture.
- Recording uses WebM/Opus where supported, with Ogg/Opus fallback and a browser default fallback.
- Voice data is converted to a normal `File` and goes through the existing client-side AES-256-GCM attachment encryption path.
- The attachment metadata (including `voiceMessage` and `durationMs`) is then encrypted with the normal Olm E2EE message path.
- The server still receives only opaque attachment ciphertext and never receives the voice plaintext, filename, or MIME metadata.
- Voice recording is capped at five minutes per message.
- Microphone permission errors and unsupported browsers receive a user-facing error.
- Recording can be cancelled without uploading or sending the captured audio.
- Stopping a recording releases the microphone stream.

### Voice message UI
- Added a microphone action in the composer.
- Active recording shows elapsed time, stop/send, and cancel controls.
- Received voice messages use the existing encrypted attachment download/decrypt path and render through the native audio player.
- Voice duration is shown when available.

### Existing media security preserved
- Existing friends-only upload/download authorization remains unchanged.
- Existing AES-GCM per-file encryption remains unchanged.
- Existing Olm encryption of attachment metadata remains unchanged.
- View-once attachment behavior remains unchanged.
- Existing orphan-attachment cleanup remains available if an upload succeeds but the subsequent message send fails.

## Validation

- ZIP structure checked after modification.
- TypeScript parser/check was run with the globally available compiler. Dependency/type packages are not installed in the supplied ZIP, so the compiler reports missing React/Next/lucide modules and their cascading JSX typing errors; no syntax/parser error was reported in the modified files.
- A full browser runtime microphone/E2EE integration test still requires installing project dependencies and running the Sakhya server/client.
