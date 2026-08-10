# Pre-release checklist (code 29 / follow-ups)

## 1. `uploads/` user media

**Status (repo):** Fixed going forward.

- `uploads/` added to `.gitignore` (keep `uploads/.gitkeep`).
- Tracked PNGs under `uploads/photos/` and `uploads/chat/` removed from the index (`git rm -r --cached uploads`).
- Files looked like real user media (UUID paths dated 2026-06).

**History purge (required for privacy):** blobs still exist in old commits until history is rewritten.

```bash
cd Backend
bash scripts/purge-uploads-from-history.sh
# Then coordinate a force-push:
git push --force-with-lease origin main
```

Do **not** force-push until the team agrees. After purge, anyone with a clone must re-clone or hard-reset.

---

## 2. npm audit triage

### Backend (after `npm audit fix`: ~1 critical / 2 high; was ~2 critical / 9 high)

| Area | Packages | Risk in our use | Action |
|------|----------|-----------------|--------|
| Critical `tar` via `@mapbox/node-pre-gyp` / `bcrypt` native toolchain | Supply-chain / arbitrary write during **install**, not runtime API | Keep Node/npm current; prefer official `bcrypt` builds; no untrusted tarball installs on prod |
| Critical `websocket-driver` | Transitive (often Faye / unused path) | Confirm not in production require graph; upgrade parent if present |
| High `ws` / `engine.io` / `socket.io-*` | DoS via large frames | Already behind auth on Socket.IO; keep `socket.io` on latest patch; rate-limit / reverse-proxy body limits |
| High `nodemailer` | SMTP injection / domain confusion | Pin latest nodemailer; never pass raw user input into envelope fields |
| High `form-data` | CRLF in multipart field names | Used by Google APIs client; upgrade `googleapis` / `gaxios` when available |
| High `js-yaml` / `brace-expansion` | Dev/transitive DoS | Prefer `npm audit fix`; low runtime exposure if only in tooling |

**Commands:**

```bash
cd Backend
npm audit
npm audit fix          # non-breaking
# Avoid npm audit fix --force unless tested (can jump majors).
```

### Frontend (approx. 1 critical / ~23 high)

Typical Expo/React Native trees pull many transitive advisories (Metro, image tooling, older webpack/babel). Most do **not** ship into the production AAB JS bundle the same way a Node server does.

| Guidance | Detail |
|----------|--------|
| Prefer Expo SDK upgrades | `npx expo install --fix` for packages Expo manages |
| `npm audit fix` | Safe patches only; re-run EAS build after |
| Critical in native/devDeps | Document and schedule; do not block release if only in `expo start` / prebuild tooling |
| Re-audit after each SDK bump | Counts change often |

---

## 3. Release tags & `/health` gitCommit

**Tags (create after commits land on `main`):**

```bash
# Frontend (app 1.0.28 / versionCode 29)
cd Frontend
git tag -a app-1.0.28-code29 -m "Play internal/production AAB 1.0.28 (versionCode 29)"
git push origin app-1.0.28-code29

# Backend (deployed API matching that client)
cd Backend
git tag -a api-code29 -m "API paired with app code 29"
git push origin api-code29
```

**Exposing SHA:**

- `GET /health` → `gitCommit` from `GIT_COMMIT` env **or** `dist/build-info.json` (written by `npm run build` / `build:light`).
- `scripts/deploy-backend.sh` still writes `GIT_COMMIT` into `.env` and restarts pm2.

After deploy:

```bash
curl -s https://100-48-93-44.nip.io/health
# expect: "gitCommit":"<full sha>"
```

---

## 4. Cleartext traffic & CORS

### Android cleartext

- Production EAS profile: `usesCleartextTraffic: false` (`EAS_BUILD_PROFILE === 'production'`).
- Preview/development: cleartext still allowed for LAN HTTP.
- Production API URLs remain `https://100-48-93-44.nip.io` in `eas.json`.

Rebuild the AAB after this change before Play production.

### CORS

- `credentials: true` + `origin: '*'` is invalid for browsers.
- In `NODE_ENV=production`, unset/`*` CORS now falls back to:
  - `https://www.citasmallorca.es`
  - `https://citasmallorca.es`
  - `https://100-48-93-44.nip.io`
- Override with comma-separated `CORS_ORIGIN` on the server when Admin or extra hosts need access.

Server example:

```env
NODE_ENV=production
CORS_ORIGIN=https://www.citasmallorca.es,https://citasmallorca.es,https://100-48-93-44.nip.io
```
