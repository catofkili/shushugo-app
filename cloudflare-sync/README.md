# Master Nihongo Cloudflare Sync

Cloudflare Worker + D1 + Workers KV backend for Master Nihongo account login and learning-data sync.

## Setup

```bash
cd cloudflare-sync
npm install
npx wrangler login
npm run d1:create
npm run kv:create
```

Copy the `database_id` printed by `d1:create` into `wrangler.jsonc`, then run:

```bash
npm run d1:migrate
npm run deploy
```

After deployment, set the iOS frontend env var:

```bash
cd ../frontend
cp .env.example .env.local
# edit VITE_SYNC_API_URL to the Worker URL printed by deploy
npm run build
npx cap sync ios
```

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/user/profile`
- `POST /api/sync/push`
- `GET /api/sync/pull`

The frontend sends the exported local SQLite database as Base64. D1 stores account/session metadata and Workers KV stores the database backups.
