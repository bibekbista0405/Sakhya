# Sakhya audit / fixes

## Fixed
- Next.js + Matrix Olm bundling: dev now uses the stable Webpack path so Olm's optional Node `fs/path/crypto` requires are stubbed correctly during Client Component SSR.
- Removed stale `client/tsconfig.tsbuildinfo` from the source archive.
- Aligned `eslint-config-next` with the Next 15.x client release line (`15.5.25`). The old lockfile was intentionally removed because it pinned an incompatible 16.x ESLint config; run `npm install` to regenerate it.
- Encrypted attachment size limit now allows AES-GCM's 16-byte authentication-tag overhead.
- View-once attachment consumption is atomic, preventing concurrent double-consume races.
- Socket sessions are revalidated on every packet, so logout-all/password changes/device revocation take effect on existing sockets.
- Typing indicators and read receipts now respect the recipient/user privacy settings server-side.
- Call signaling now verifies that only the two participants can accept/reject/end calls or relay ICE candidates.
- Chat message socket effect includes the authenticated user in its React dependency list, avoiding a stale user closure after auth state changes.

## Important runtime setup
1. From the Sakhya root, delete any old `node_modules` and run `npm install`.
2. Copy `server/.env.example` to `server/.env` and set a strong `JWT_SECRET` for production.
3. Copy `client/.env.local.example` to `client/.env.local` when non-default API/socket URLs are needed.
4. Run `npm run dev`.
5. For production, run `npm run build` then `npm run start`.

## Audit limitations
The archive does not contain a complete installed dependency tree, browser session, external TURN server, or production deployment environment, so those environment-specific behaviors must still be smoke-tested locally.
