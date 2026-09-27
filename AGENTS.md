# Armut Pen development notes

## Live source and storage
- Use `docker compose -f docker-compose.base44.yml up -d --build`. Vite serves the mounted repository on port 3000 and proxies `/api` to Uvicorn. Both have live reload; do not restore the obsolete nginx setup.
- SQLite is `/data/armut.sqlite3` in `armut-data`, not the source tree. The one-shot `migrate` service runs `server.db` and must complete before the API starts; the application also checks the idempotent schema on reload. Never use `down -v` without asking: it erases users/projects.
- Cookie sessions are opaque random tokens (only SHA256 hashes stored), HttpOnly/Secure/SameSite=Lax, valid 30 days. Browser preview must use HTTPS. Local curl tests need an HTTPS cookie jar or ASGI client; don't disable cookie security to make them pass.
- Mutations require `X-Armut-Request: 1`; no cross-origin API/CORS access is enabled. Every private resource is scoped to the authenticated user. Project saves use optimistic revision checking: don't discard conflicts.

## Credentials and integrations
- No app-owner secrets are needed to boot. User-supplied provider keys and GitHub PATs exist in frontend module memory only and are sent per request to fixed provider endpoints by the backend. Never persist them to localStorage, SQLite, logs or committed files. Reload/log out clears them. Old `nomi_ai_settings` storage is deleted on startup to remove former plaintext keys.
- GitHub uses PATs, NOT OAuth. Account sign-in fetches a verified primary email; an existing email/password account must sign in first and explicitly link its GitHub identity in settings. There is no Google sign-in.
- Real AI and GitHub tests require user-owned authorized credentials. Never invent a key, substitute a demo answer, or claim provider access was tested without credentials. Model identifiers are in `server/integrations.py`; provider rejection surfaces as an error and AI credits are refunded.
- Credit day uses Europe/Istanbul. Requests reserve credits atomically before the upstream call. Jobs lock their project. Failed jobs refund credits; development startup refunds jobs interrupted by a reload. Run one API process with this recovery design (no multi-worker deployment until redesigned).
- GitHub repo creation defaults private. Push creates one non-force commit and retains remote files not present in the editor. Pages requires separate user confirmation and may expose site content publicly.

## Frontend boundaries
- `workspace.js`: authentication, onboarding, projects, autosave, versions, chat, modes, transient keys.
- `app.js`: editor, sandboxed srcdoc previews, file tree/import/export, console bridge.
- `editor-tools.js`: renaming, Prettier formatting, Acorn/JSON/Prettier syntax checks, templates.
- Keep both preview iframes sandboxed WITHOUT allow-same-origin. User and AI code must not access application cookies, DOM, or key memory. Chat, file paths, and project names render as text, never raw HTML.
- Non-secret per-user preferences/last project are localStorage; projects, messages, onboarding survey and last 30 versions are server-side. Autosave errors remain visible, and switching/logging out waits for a successful save.
- Media imports become data URLs in private project JSON; max 500 KB per imported file, 2 MB/200 files per project. Archive extraction is not supported. Use ZIP export for a local backup before resolving a revision conflict.

## Verification
- `docker compose -f docker-compose.base44.yml ps` (both healthy).
- `curl -fsS http://localhost:3000/api/models`; unauthenticated `/api/projects` must return 401.
- `docker compose -f docker-compose.base44.yml exec -T web npm run build` and `docker compose -f docker-compose.base44.yml exec -T api python -m compileall -q server`.
- One-off ASGI regression checks in /tmp exercised auth uniqueness, cookie security, survey, ownership, revisions, path validation, versions, AI mock failure/refund, successful reservation, concurrent quota enforcement, day rollover, CSRF and logout. They do not prove live provider/model availability.
- This is a development preview, not a production cloud deployment. Back up the volume and configure production TLS, serving and an email ownership/recovery flow before production use.
