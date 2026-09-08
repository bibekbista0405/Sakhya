# Sakhya E2EE Fix Notes

## Fixed: IndexedDB version downgrade error

Older Sakhya builds may have created `sakhya-crypto` at IndexedDB version 3. The client previously attempted to open version 1, which browsers reject with:

`The requested version (1) is less than the existing version (3).`

The client now opens version 3 and preserves the existing `kv` object store. Existing keys/accounts are therefore retained and upgraded normally.

## Fixed: device-registration race

E2EE device registration is now serialized and awaitable. Login/register waits for registration before navigating to Chats, so the first message cannot race the `/devices/register` request.

## If a browser was left with a broken crypto database

Normally no data loss is needed. If the browser database is genuinely corrupted, use the app's Forget Device Identity action or manually delete the `sakhya-crypto` IndexedDB database and reload. This creates a new E2EE identity and requires peers to establish a new session.
