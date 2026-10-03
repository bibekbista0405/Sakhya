# Sakhya Phase 10 — Multi-Device Security & Pairing

## Implemented

- Device management is now a first-class Settings feature.
- Each browser/device keeps its own Olm identity; private E2EE keys are never sent to the server.
- Device registry now tracks a primary device and current device.
- Device activity is refreshed from authenticated requests.
- Devices can be renamed from Settings.
- Individual devices can be revoked; revocation also removes their authentication sessions and unclaimed prekeys.
- A signed-in device can revoke all other devices in one action.
- Registering a new device creates a security notification on the account when another device already existed.
- Added short-lived device pairing approvals (5-minute lifetime).
- Pairing secrets are random, one-time bearer values; only SHA-256 hashes are persisted server-side.
- Pairing payloads can be rendered as QR codes or copied as text.
- Pairing is an approval mechanism, not a private-key cloning mechanism. The new device keeps its own Olm identity and ratchet state.
- Existing E2EE fan-out remains unchanged: each device receives its own encrypted envelope.

## Security model

The server stores public device identity keys, fallback public keys/signatures, one-time prekeys, device metadata, and hashed pairing secrets. It does not receive an Olm private identity key during pairing.

A pairing QR/code only authorizes a new device enrollment after a user-controlled approval on another signed-in Sakhya device. Pairing codes expire quickly and are rate-limited by the existing sensitive-settings limiter.

## Git commit

Recommended commit:

`feat(phase-10): add secure multi-device management and device pairing`
