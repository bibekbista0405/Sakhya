# Sakhya Next.js runtime fix

Fixed intermittent Windows development runtime errors such as:

`ENOENT: no such file or directory, open client/.next/server/app/page.js`

Changes:
- Development uses Next.js 15.5.25 Webpack mode by default. `next dev` is intentionally used because Webpack is the default in this Next.js version and `--webpack` is not a supported CLI option here.
- `client/.next` is automatically removed once before each development start, preventing stale/corrupted App Router server artifacts from being reused.
- Existing E2EE, decrypt-race, calling, and account-scope fixes are preserved.

If a dev server is already running, stop it first and run `npm run dev` again.
