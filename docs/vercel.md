# Deploying to Vercel

A tunnel is fine for testing and fatal for a submission: reviewers open the URL days
later and find it dead. This is the shortest path to a stable origin.

## What changed to make it work

| Problem on Vercel | Fix |
|---|---|
| The filesystem is ephemeral, so a SQLite file loses every build between invocations | The database is **libSQL** — the same SQLite dialect, so the schema and queries are untouched. A `file:` URL locally, a `libsql://` URL on Vercel. The app **refuses to start** on Vercel with a file URL rather than appear to work and lose data. |
| A function can be frozen the moment its response is sent, stranding a build mid-flight | The build routes use `after()` to keep the invocation alive until the build settles. |
| The timeline stream read an in-memory event bus, but the build and the viewer are *different instances* on serverless | The stream **polls the database**, which every instance agrees on. Events were already persisted first. |
| The generated-app template is read from disk at runtime | `outputFileTracingIncludes` ships it with both build routes (verified in the build trace). |

## 1. A database — Turso

Create it once and keep its credentials in `.env.local` under the `*_PRODUCTION` names,
so running the app locally never touches it:

```bash
turso auth login --headless          # approve in the browser, then: turso config set token "$(pbpaste)"
turso db create xemo --location aws-us-east-1     # Vercel's default region is iad1
turso db show xemo --url                          # DATABASE_URL_PRODUCTION
turso db tokens create xemo                       # DATABASE_AUTH_TOKEN_PRODUCTION
```

Reading a token from the clipboard keeps it out of terminal history and out of any chat.
The schema is created automatically on first start (`src/instrumentation.ts`); there is
no migration step. Verified against a real Turso database: the app builds its own
tables, and the ledger's unique index rejects a duplicate payment id.

## 2. Import the repo

Vercel → **Add New… → Project** → import `Khalid-000-ME/xemo`. Framework (Next.js),
install and build commands are detected. Leave the root directory alone.

## 3. Environment variables — import a file, do not copy them one by one

```bash
node scripts/vercel-env.mjs
```

writes `.env.vercel` (gitignored, mode 600) from `.env.local` and prints only variable
names and whether each is set. In Vercel: **Settings → Environment Variables → Import
.env**, drag the file in, set the environment to **Production**. Delete the file after.

It deliberately omits two things:

- `NEXT_PUBLIC_APP_URL` — a localhost or tunnel origin. The app falls back to the
  production hostname Vercel injects. Set it by hand only for a custom domain.
- `STRIPE_WEBHOOK_SECRET` — the one in `.env.local` belongs to the local CLI listener. A
  deployed endpoint has its own secret (step 5). To include it, put it in `.env.local`
  as `STRIPE_WEBHOOK_SECRET_PRODUCTION` and rerun the script.

## 4. Deploy, then check

```bash
BASE=https://<your-project>.vercel.app pnpm smoke      # expect 33/33
curl -s https://<your-project>.vercel.app/api/capabilities | jq '.buildReady, .missing'
```

If `/api/capabilities` is a Vercel login page, turn off **Deployment Protection** for
Production (Settings → Deployment Protection). Preview URLs are protected by default and
a PayBox sandbox cannot get through that.

## 5. Stripe webhook

The CLI listener only forwards to localhost. For the deployment, in the Stripe dashboard
(Test mode) → Developers → Webhooks → **Add endpoint**:

- URL: `https://<your-project>.vercel.app/api/stripe/webhook`
- Events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`

Copy its signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

## 6. Point PayBox at it

In the portal, **Test & configure** — no re-upload and no re-review, config only:

- Variables: `XEMO_API_URL` = `https://<your-project>.vercel.app`
- Network access: `<your-project>.vercel.app`

## Known limits

- **Function duration.** The build routes declare `maxDuration = 300`. A build takes
  about 10 seconds, so this is headroom, not a dependency.
- **Apps built under the tunnel keep calling the tunnel.** Their platform origin is baked
  into their source at build time, so rebuild anything you want to demo after the move.
- **x402 on mainnet needs the CDP credentials** in the Vercel environment too; without
  them the x402 routes answer `503` and name the variable.
