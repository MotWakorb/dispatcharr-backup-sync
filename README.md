# Dispatcharr Backup Sync

Svelte + Express toolkit for backing up, syncing, and restoring Dispatcharr configuration between instances. Jobs run through the backend API with live progress and download links in the UI.

## What it does
- Test connections to Dispatcharr and pull instance info.
- Export config (JSON or YAML) with optional logo bundle (zip or tar.gz).
- Import previously exported bundles.
- Two-way sync between instances with per-area toggles (channels, profiles, M3U sources, stream profiles, user agents, core settings, EPG sources, plugins, DVR rules, comskip config, users, logos).
- Saved connection vault plus job history and logs.

## Quick start (Docker)
Ports: frontend `3002`, backend `3001`.

```bash
docker compose up -d

# health check
curl http://localhost:3001/health
```

Open http://localhost:3002 to use the app.

## Build the images locally
```bash
# from repo root
docker build -t ghcr.io/motwakorb/dispatcharr-backup-sync-backend:latest -f docker/backend.Dockerfile .
docker build -t ghcr.io/motwakorb/dispatcharr-backup-sync-frontend:latest -f docker/frontend.Dockerfile .

docker compose down && docker compose up -d
```

Both Dockerfiles run `npm install` inside the build stage (no host installs needed). The frontend build includes a small runtime patch executed during `npm postinstall` to initialize Svelte DOM operations.

## Local development (containerized npm)
Run commands in disposable Node containers to avoid installing on the host:
```bash
# backend dev server (port 3001)
docker run --rm -it -v %cd%/backend:/app -w /app -p 3001:3001 node:20-alpine sh -c "npm install && npm run dev"

# frontend dev server (port 3002)
docker run --rm -it -v %cd%/frontend:/app -w /app -p 3002:3000 node:20-alpine sh -c "npm install && npm run dev -- --host --port 3000"
```

## API surface
- `GET /health` - backend status.
- `POST /api/connections/test` and `/api/connections/info`
- `POST /api/sync`, `GET /api/sync/status/:jobId`, `GET /api/sync/jobs`
- `POST /api/export`, `GET /api/export/status/:jobId`, `GET /api/export/download/:jobId`, `GET /api/export/download/:jobId/logos`
- `POST /api/import`, `GET /api/import/status/:jobId`
- Jobs: `GET /api/jobs`, `GET /api/jobs/history/list`, `GET /api/jobs/:jobId/logs`
- Saved connections CRUD: `/api/saved-connections`

## Notes
- Job state is in-memory; restarting the backend clears active/history data.
- Logo upload/download can take time with large sets.
- The frontend build is non-minified with sourcemaps enabled for easier debugging.

## Tests
Run the Playwright smoke test against the running docker-compose stack (uses disposable Node container and installs Playwright/browsers inside it):
```bash
# PowerShell
docker run --rm --network dispatcharr-backup-sync_dispatcharr-manager -v ${PWD}/tests:/work -w /work node:20 sh -c "\
  npm install playwright@1.48.2 --no-save --no-package-lock && \
  npx playwright install --with-deps chromium && \
  node smoke.playwright.mjs"

# bash
docker run --rm --network dispatcharr-backup-sync_dispatcharr-manager -v $(pwd)/tests:/work -w /work node:20 sh -c "\
  npm install playwright@1.48.2 --no-save --no-package-lock && \
  npx playwright install --with-deps chromium && \
  node smoke.playwright.mjs"
```
Set `TARGET_URL`/`BACKEND_HEALTH` env vars to override defaults (`http://frontend:80`, `http://backend:3001/health`).

## License
MIT
