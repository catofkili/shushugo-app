# Database Layout

This project has two active databases and one legacy prototype. Keep them separate.

## 1. Local App SQLite

Location:

- Runtime asset: `frontend/public/nihongo.db`
- iOS copied asset: `frontend/ios/App/App/public/nihongo.db`
- Schema helpers: `frontend/src/lib/database/`
- Main schema file: `frontend/src/lib/database/local-schema.sql`

Purpose:

- Bundled Japanese learning content
- On-device learning progress
- Notes, favorites, reviews, check-ins

Git policy:

- `frontend/public/nihongo.db` is intentionally not tracked.
- Large static corpus files are local assets and are added only by `scripts/package-preview.sh`.

## 2. Cloudflare D1

Location:

- Worker: `cloudflare-sync/src/index.ts`
- Migrations: `cloudflare-sync/migrations/`

Purpose:

- Cloud account login
- Session tokens
- Email verification tokens
- App Store entitlement records
- Cloud backup metadata

Rules:

- Add schema changes as new numbered migrations.
- Apply remote migrations with:

```bash
cd cloudflare-sync
npm run d1:migrate:remote
```

## 3. Legacy Python Backend

Location:

- `backend/`

Status:

- Legacy prototype only.
- Not the production backend.
- Do not add new SQL here unless explicitly reviving the FastAPI prototype.

Production cloud work belongs in `cloudflare-sync/`.
