# Setup

Xemo has **no simulated mode**. Every rail is real, so it needs real
credentials before a build will start. This is the order to do it in; each step says how
to verify it worked before moving on.

Run `pnpm smoke` at any point — it prints exactly which rails are ready and which
variables are still missing.

---

## 0. Install

```bash
pnpm install
cp .env.example .env.local
```

Everything below goes in `.env.local`. It is gitignored; never commit it.

---

## 1. Agent model — `ANTHROPIC_API_KEY`

The planner and the fulfilment engine both need this. Without it a build refuses to
start.

1. Go to <https://console.anthropic.com> → **API keys** → create a key.
2. `ANTHROPIC_API_KEY=sk-ant-...`

The model defaults to `claude-sonnet-5-5`. Override with `XEMO_MODEL`, but only
to a model listed in `src/lib/pricing.ts` — an unpriced model throws rather than having
its cost guessed.

**Verify:** `pnpm smoke` shows `● Agent model`.

---

## 2. CreateOS sandbox — `CREATEOS_SANDBOX_API_KEY`

Generated code only ever executes inside a Firecracker microVM, and the app is published
on that sandbox's public ingress URL.

Either provision it through Stripe Projects (which creates the CreateOS account for you):

```bash
npm install -g @stripe/cli
stripe plugin install projects
stripe projects init xemo
stripe projects add createos/project
stripe projects env --pull
```

…or get a token directly from <https://createos.sh/app/profile>.

```env
CREATEOS_SANDBOX_API_KEY=...
CREATEOS_SHAPE=s-1vcpu-1gb
CREATEOS_ROOTFS=devbox:1
```

> **Plan limits matter here.** The **Free** plan runs **one** concurrent sandbox and only
> 10 per day, and *paused* sandboxes still count against the cap — a create over the cap
> fails with `429` rather than queueing. Xemo reclaims its own oldest sandboxes
> to stay inside `CREATEOS_MAX_CONCURRENT_SANDBOXES`, but with that set to 1 each new
> build destroys the previous app. **For a demo where several apps must stay live at
> once, use the Beginner plan (5 concurrent) and set the variable to match:**
>
> ```env
> CREATEOS_MAX_CONCURRENT_SANDBOXES=5
> ```

`CREATEOS_ROOTFS` must stay `devbox:1`. The catalog default is Alpine, which has no Node
toolchain.

**Verify:** `pnpm smoke` shows `● CreateOS sandbox` and a `createosReachable.ok` of true
in `/api/capabilities`.

---

## 3. Stripe — the human rail

Both variables are required: the webhook refuses to trust a payload it cannot verify, so
a secret key without a signing secret is not a usable configuration.

1. <https://dashboard.stripe.com> → make sure **Test mode** is on.
2. **Developers → API keys**:
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
3. Install the CLI. On macOS use Homebrew — a global npm install needs write access to
   the npm prefix and usually fails with `EACCES`:
   ```bash
   brew install stripe/stripe-cli/stripe
   ```
4. Forward events to the local app. **CLI 1.50+ requires `--events`** — the bare command
   exits with `must specify events to forward`. Passing `--api-key` also skips the
   browser `stripe login`:
   ```bash
   stripe listen \
     --api-key "$STRIPE_SECRET_KEY" \
     --events checkout.session.completed,checkout.session.expired,payment_intent.payment_failed \
     --forward-to localhost:3000/api/stripe/webhook
   ```
   It prints `Your webhook signing secret is whsec_...`. Put that in
   `STRIPE_WEBHOOK_SECRET` and **leave the command running** — no listener means no
   webhook, and an order stays on `created` forever.

   To read the secret without starting the listener:
   `stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret`

   For a deployed instance, create the endpoint in the dashboard against
   `https://<your-url>/api/stripe/webhook` and use its signing secret instead.

**Verify:** `pnpm smoke` shows `● Stripe · human rail` **and** the webhook section reads
"refuses an unsigned payload" rather than "refuses to trust an unverifiable payload" —
the second means the secret is still missing. To prove the signed path end to end:

```bash
stripe trigger checkout.session.completed --api-key "$STRIPE_SECRET_KEY"
```

The listener should log `<-- [200] POST .../api/stripe/webhook`. A `400` there means the
stored secret and the running listener disagree.

Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

---

## 4. x402 — the agent rail

### `X402_PAY_TO` — where payments land

Any EVM address you control. Until this is set the x402 routes answer `503` rather than
advertise a priced resource with nowhere to pay.

```env
X402_PAY_TO=0xYourAddress
X402_NETWORK=eip155:84532              # Base Sepolia (testnet)
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_COMMISSION_PRICE_USD=0.50         # what an agent pays per build
X402_GENERATED_APP_PRICE_USD=0.02      # what an agent pays per call to a built app
```

### A buyer wallet, to actually pay

To demonstrate a settled payment you need a **second** wallet holding Base Sepolia USDC:

1. Get Base Sepolia ETH from a faucet (for gas).
2. Get Base Sepolia USDC from <https://faucet.circle.com> (select Base Sepolia).

The USDC contract the challenge advertises on Base Sepolia is
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

### Going to mainnet (required for PayBox)

PayBox only accepts x402 proposals on Base mainnet or Solana mainnet, and the public
facilitator is **testnet only**, so mainnet needs both of these:

```env
X402_NETWORK=eip155:8453
CDP_API_KEY_ID=...        # free, https://portal.cdp.coinbase.com
CDP_API_KEY_SECRET=...
```

With CDP credentials present the platform uses the CDP facilitator automatically and
`X402_FACILITATOR_URL` is ignored. Without them, the x402 routes answer `503` with a
message naming the facilitator, the network, what it *does* support, and the variable to
set — they do not hang, and they do not take the server down.

Only do this if you intend real money to move.

**Verify:**

```bash
curl -i -X POST http://localhost:3000/api/x402/commission \
  -H 'content-type: application/json' \
  -d '{"prompt":"Build a paid prediction market resolution auditor that charges $5 per audit"}'
```

You want `HTTP/1.1 402 Payment Required` and a `payment-required` header. Decode it to
check the payee and amount:

```bash
curl -sD - -o /dev/null -X POST http://localhost:3000/api/x402/commission \
  -H 'content-type: application/json' -d '{"prompt":"test build request here"}' \
  | grep -i '^payment-required:' | sed 's/^[^:]*: //' | tr -d '\r' | base64 -d | jq
```

---

## 5. PayBox — no server credential needed

There is nothing to put in `.env.local` for PayBox. Xemo is a **merchant** on
PayBox, not a spender: PayBox-connected agents discover and pay the x402 endpoints from
step 4, and that needs no key on this side.

What you *do* need is a PayBox account, a passkey, KYC, and a funded wallet — so that
**you can act as the buyer** when demoing, and so you are eligible to submit.
[`paybox.md`](paybox.md) covers all of it, and explains why the outbound client was
removed.

## 6. Public URL

Payment requirements and every generated app's callbacks are built from this, so
`localhost` here means `localhost` there. Set it to the real origin once deployed:

```env
NEXT_PUBLIC_APP_URL=https://your-deployment
```

Then point the PayBox plugin at it — `paybox-plugin/.mcp.json`:

```json
{ "mcpServers": { "xemo": { "type": "http", "url": "https://your-deployment/api/mcp" } } }
```

---

## Final check

```bash
pnpm build && pnpm start
pnpm smoke
```

Every rail should read `●`, and `buildReady` should be `true`. Then run one build from the
home page and confirm the timeline reaches **live**.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `MISSING_CREDENTIALS` with a variable list | Exactly what it says — no simulated mode will cover for it. |
| CreateOS create fails `429` | At the plan's concurrent cap. Raise the plan, or lower `CREATEOS_MAX_CONCURRENT_SANDBOXES` so builds reclaim slots. |
| `npm run typecheck` fails in the sandbox | A template placeholder did not render. The renderer asserts this, so the build fails rather than shipping a broken app. |
| Deployed app URL does not resolve over HTTPS | A fresh ingress hostname can serve before its TLS certificate lands; the runner probes and falls back to `http`. |
| Order stuck on `created` | The webhook never arrived. Is `stripe listen` still running, and does its secret match? |
| `stripe: command not found` | CLI not installed — `brew install stripe/stripe-cli/stripe`. |
| `must specify events to forward` | CLI 1.50+ needs `--events`; see step 4 above. |
| `npm install -g @stripe/cli` fails `EACCES` | No write access to the npm prefix. Use Homebrew instead. |
| Webhook returns `400` on a triggered event | `STRIPE_WEBHOOK_SECRET` does not match the running listener. Re-read it with `--print-secret`. |
| x402 route answers `503` | Read the body. Either `X402_PAY_TO` is unset, or the facilitator cannot settle on `X402_NETWORK` — mainnet needs `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`. |
| `stripe: You have not configured API keys yet` | `$STRIPE_SECRET_KEY` is not in your shell. Run `set -a && source .env.local && set +a` first. |
