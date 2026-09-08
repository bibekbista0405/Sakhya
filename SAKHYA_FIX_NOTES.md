# Sakhya startup fix

- Client dev script no longer uses Turbopack because this project relies on a Webpack fallback for `@matrix-org/olm`.
- `fs`, `path`, and `crypto` are now stubbed for all Webpack builds so Olm's optional Node requires do not break Client Component SSR.
- Existing `/public/olm.wasm` loading is preserved.

Run from the Sakhya root:
```powershell
Remove-Item -Recurse -Force client\.next -ErrorAction SilentlyContinue
npm install
npm run dev
```
