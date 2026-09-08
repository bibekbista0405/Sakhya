# Sakhya E2EE account-scope fix

## Root cause

The old E2EE IndexedDB database was global (`sakhya-crypto`) and the private Olm
account keys were not scoped to the authenticated Sakhya user. That created two
separate failures:

1. An old bundle could still call `indexedDB.open("sakhya-crypto", 1)` while the
   database already existed at version 3, producing `VersionError: The requested
   version (1) is less than the existing version (3)`.
2. If two Gmail/Sakhya accounts were used in the same browser, both accounts could
   reuse the same local Olm identity because `DEVICE_ID_KEY`, the account pickle,
   sessions and trust records shared one database. This could make one account
   appear to have no usable encryption device or associate the wrong device with
   the current server account.

## Fix

The client now uses a new database namespace:

` sakhya-crypto-v2:<authenticated-user-id> `

Each account therefore has its own:
- Olm account pickle
- pickle secret
- device ID
- peer sessions
- trust/pinned identities

The new database starts at version 1, so it cannot collide with the old global
version-3 database. The old database is intentionally not migrated because its
contents cannot safely be attributed to a specific account after multiple
accounts may have used the browser.

The in-memory Olm account is also reset whenever `ensureDeviceRegistered(userId)`
sees a different authenticated user, preventing account A's WASM account from
being reused by account B.

`encryptForPeer()` now ensures the current account's device is registered before
attempting a peer session.

## Required local test after updating

1. Stop the dev server.
2. Delete `client/.next`.
3. Start with `npm run dev`.
4. Log into account A and wait for Chats to load.
5. Log into account B in a separate browser profile/incognito window, or log out
   and then log back in normally.
6. Verify each account gets its own entry under Settings → Devices.
7. Send a message A → B, then B → A.
8. The first message should establish the Olm session; subsequent messages should
   use the saved session.

If an old tab is still running code from before this fix, close all Sakhya tabs and
reopen `http://localhost:3000`. The current source no longer opens the old
`sakhya-crypto` database at all.
