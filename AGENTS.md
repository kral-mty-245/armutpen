# Base44 Dev Environment

## What this app is
Armut Pen v7.1 — a static single-page HTML code editor with a "NOMI AI" assistant.
The entire app is one file: `index.html` (with CDN-loaded JS libs: JSZip, FileSaver, highlight.js).
There is no build step, no framework, no package.json.

## How it runs here
Served as static files by `nginx:alpine` via `docker-compose.base44.yml`:
- The repo root is bind-mounted (read-only) to `/usr/share/nginx/html`.
- Custom nginx config (`nginx.base44.conf`) serves `index.html` and returns HTTP 410 for `/api/github`
  (the GitHub integration is intentionally disabled — see `GITHUB_OAUTH.md`).
- Edits to `index.html` / static files are reflected immediately on browser refresh (no rebuild needed).

## No secrets required
- The AI features (Gemini, Anthropic, OpenAI, xAI, DeepSeek) call external APIs **directly from the browser**
  using API keys the user enters in the in-app Settings UI (stored in `localStorage` under `nomi_ai_settings`).
  No server-side keys or backend are involved.
- The GitHub integration is disabled, so no GitHub credentials are needed.

## Gotcha
The repo root directory was created mode 700; nginx's worker user (`nginx`) cannot traverse it and returns 403.
`chmod -R a+rX .` was applied to fix this. If a fresh clone shows 403 on `/`, re-run that chmod.

## Verify it works
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` → 200
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/github` → 410
