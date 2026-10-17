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

## 1. A database — Turso, about 3 minutes

```bash
brew install tursodatabase/tap/turso
turso auth login
turso db create xemo
turso db show xemo --url          # -> libsql://xemo-<you>.turso.io
turso db tokens create xemo       # -> the auth token
```

The schema is created automatically on first start (`src/instrumentation.ts`); there is
no migration step.

## 2. Import the repo

Vercel → **Add New… → Project** → import `Khalid-000-ME/xemo`. Framework (Next.js),
install and build commands are detected. Leave the root directory alone.

## 3. Environment variables

Set these for **Production** before the first deploy:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the `libsql://…` URL |
| `DATABASE_AUTH_TOKEN` | the Turso token |
| `GROQ_API_KEY` | as in `.env.local` |
| `XEMO_MODEL` | `openai/gpt-oss-120b` |
| `CREATEOS_SANDBOX_API_KEY` | as in `.env.local` |
| `CREATEOS_SHAPE` / `CREATEOS_ROOTFS` | `s-1vcpu-1gb` / `devbox:1` |
| `CREATEOS_MAX_CONCURRENT_SANDBOXES` | your plan's real cap |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | as in `.env.local` |
| `STRIPE_WEBHOOK_SECRET` | **new** — from step 5, not the CLI listener's |
| `X402_PAY_TO` | your payee address |
| `X402_NETWORK` | `eip155:8453` |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | as in `.env.local` |
| `X402_COMMISSION_PRICE_USD` | `0.05` |
| `X402_GENERATED_APP_PRICE_USD` | `0.02` |

`NEXT_PUBLIC_APP_URL` is optional on the first deploy: the app falls back to the
production hostname Vercel injects. Set it explicitly if you attach a custom domain.

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
