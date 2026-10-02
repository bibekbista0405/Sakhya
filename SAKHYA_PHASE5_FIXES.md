# Sakhya Phase 5 — API / Session / Authorization Hardening

Implemented on top of Phase 4 without replacing the existing UI or application architecture.

## Session security
- Authentication sessions now store a SHA-256 hash of the bearer token instead of the raw token.
- Existing databases are migrated transactionally: legacy plaintext session tokens are hashed and the old `token` column is physically removed by rebuilding the `sessions` table.
- REST authentication and Socket.IO authentication both validate the hashed session token and expiry.
- Socket packets update `lastActiveAt`, so session activity reflects real use.
- Per-user message/call rate-limit state is cleaned when the last socket disconnects.

## Authorization boundary fixes
- `clear chat` now requires an active friendship.
- The conversation media endpoint now requires an active friendship.
- Reported `messageId` values are validated to ensure the message actually belongs to the reporter and reported user.

## Proxy / IP handling
- Removed unconditional `trust proxy = 1`.
- `TRUST_PROXY_HOPS` controls how many reverse-proxy hops Express trusts; default is `0`.
- Session IP metadata now uses Express `req.ip`, so an arbitrary `X-Forwarded-For` header is not trusted when no proxy is configured.

## Production configuration
If Sakhya runs behind one trusted reverse proxy, set:

```env
TRUST_PROXY_HOPS=1
```

For multiple trusted proxy hops, set the corresponding number. Keep this value at `0` for a directly exposed server.

## Validation
- Phase 4 code was re-audited before these changes.
- Modified TypeScript files passed delimiter/static integrity checks.
- Full dependency-backed TypeScript/build execution was not available in this environment because `node_modules` is not installed in the supplied ZIP.
