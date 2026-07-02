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
npm run d1:migrate:remote
npm run deploy
```

## Transactional email

Email verification and password reset use Resend's REST API.

1. Add a sending domain in Resend.
2. Add the DNS records Resend shows for SPF, DKIM, and DMARC.
3. Create a Resend API key.
4. Store it as a Worker secret:

```bash
cd cloudflare-sync
npx wrangler secret put RESEND_API_KEY
```

Set the sender address as a Worker variable or secret:

```bash
npx wrangler secret put EMAIL_FROM
# Example value:
# Master Nihongo <noreply@your-domain.com>
```

For a quick private test, Resend's default `onboarding@resend.dev` sender can be used, but production should use a verified domain sender.

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
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `POST /api/auth/send-verification-email`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/user/profile`
- `GET /api/entitlements`
- `POST /api/purchases/verify`
- `POST /api/sync/push`
- `GET /api/sync/pull`

The frontend sends the exported local SQLite database as Base64. D1 stores account/session metadata and Workers KV stores the database backups.
