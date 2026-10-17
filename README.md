# AgentFoundry

**One prompt in. A business that sells to humans *and* to agents out.**

AgentFoundry plans a product, writes it, runs it in a CreateOS Firecracker microVM,
publishes it to a public URL, and then opens **two** payment rails on the finished app:
Stripe Checkout for people, and an [x402](https://x402.org) endpoint for machines. Every
dollar in and every cent out lands in one ledger, so the app reports its own gross margin
from the first sale.

It is submitted to two hackathons as two faces of one engine:

| Submission | What it is |
| --- | --- |
| **AgentFoundry** — CreateOS × Stripe | An agent that writes code, executes and tests it in a CreateOS sandbox, deploys it, and takes Stripe payments. |
| **AppFactory** — PayBox Chapter 1 | A PayBox marketplace plugin whose MCP tools front an x402-gated build service any PayBox-connected agent can buy. |

---

## Why this is not another "prompt → app" demo

Code generation is the table stakes here, not the claim. Three things make this different:

**1. The generated app is an x402 *seller*, not just a Stripe seller.** Every app
AgentFoundry ships comes online with a branded human storefront *and* a machine-readable
agent endpoint plus `/.well-known/x402` terms. One prompt produces a business with two
customer types on day zero.

**2. The economics are the product.** Revenue splits into human (Stripe) and agent (x402);
cost splits into inference and metered sandbox compute. Inference cost is computed from
the token usage the provider actually reports against a real rate card, and compute from
real sandbox seconds — so the margin on the dashboard is measured, not estimated.

**3. AgentFoundry sells itself the same way it teaches its apps to sell.** The build
service is itself an x402 resource at $0.50 a build. The platform is merchant of record
for itself and for everything it ships.

---

## The loop

```
  prompt
    │
    ├─ plan ........... a model writes the product spec: name, positioning,
    │                   the deliverable's fields, the fulfilment instructions
    ├─ generate ....... template + substitution; a surviving placeholder is a
    │                   hard error, never a shipped app
    ├─ provision ...... CreateOS microVM, public ingress on, egress allowlisted
    ├─ install ........ npm install
    ├─ typecheck ...... node --check on every generated file
    ├─ test ........... smoke test against a real server boot (10 assertions)
    ├─ publish ........ public HTTPS URL
    ├─ monetize ....... Stripe product + price   → humans
    │                   x402 gateway + bazaar     → agents
    └─ book ........... compute seconds and inference priced into the ledger
         │
         ▼
   live app · both rails · revenue, cost and margin
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js 16 · App Router · the platform                      │
│                                                              │
│  /                 prompt → build                            │
│  /build/:id        live SSE timeline                          │
│  /dashboard        dual-rail economics ledger                │
│                                                              │
│  /api/x402/commission      ← agents buy a BUILD  ($0.50)     │
│  /api/x402/apps/:buildId   ← agents buy FROM an app ($0.02)  │
│  /api/mcp                  ← the PayBox plugin's MCP server  │
│  /api/stripe/webhook       ← humans' payments settle         │
└───────────┬──────────────────────┬───────────────────────────┘
            │                      │
            ▼                      ▼
   ┌─────────────────┐    ┌──────────────────────────┐
   │ CreateOS        │    │ Generated app            │
   │ Firecracker VM  │───▶│ zero dependencies        │
   │ public ingress  │    │ holds no secrets         │
   │ egress allowlist│    │ Stripe page + x402 terms │
   └─────────────────┘    └──────────────────────────┘
```

**Generated apps hold no API keys.** They are branded storefronts; payment capture,
model inference and the ledger stay on the platform. That is why a generated app can be
zero-dependency — and why a deploy cannot fail on an `npm install`.

## Quick start

```bash
pnpm install
cp .env.example .env.local      # then fill it in — see docs/setup.md
pnpm dev
```

**There is no simulated mode.** Every rail is real, and a missing credential fails the
request with a message naming the exact variable rather than producing a number nobody
should trust. The home page and `/api/capabilities` both report which rails are ready;
builds refuse to start until the required ones are. [`docs/setup.md`](docs/setup.md) is
the credential checklist.

Verify the surfaces an agent or a judge will touch:

```bash
pnpm smoke                             # 32 assertions over real HTTP
BASE=https://your-deployment pnpm smoke
```

### Wiring the real rails

```bash
# CreateOS compute + the rest of the stack, provisioned from the terminal
npm install -g @stripe/cli
stripe plugin install projects
stripe projects init agentfoundry
stripe projects add createos/project    # creates the account, writes .env
stripe projects env --pull
```

Then set `X402_PAY_TO` to the address that should receive payments, and
`ANTHROPIC_API_KEY` for the planner. Until `X402_PAY_TO` is set the x402 routes answer
`503` rather than advertise a priced resource with nowhere to pay.

## The PayBox plugin

`paybox-plugin/` is packaged in the real format used by
[`moonpay/paybox-plugin`](https://github.com/moonpay/paybox-plugin) — a plugin contributes
**an MCP server and skills**, not a bespoke payment manifest.

```
paybox-plugin/
├── .grok-plugin/plugin.json          manifest
├── .mcp.json                         → your deployment's /api/mcp
└── skills/
    ├── appfactory-commission-apps/   quoting, paying, waiting out a build
    └── appfactory-operate-apps/      reading economics, buying from an app
```

AppFactory's MCP tools are **read-only and never spend**. They quote a price and hand
back x402 terms; PayBox's `pay_x402` does the paying, which keeps payment authority with
PayBox and the user's passkey.

```
quote_app_build          → terms + priceUsd        (nothing spent)
tell the user the price
pay_x402 on the resource → X-PAYMENT header        (user approves)
POST the resource        → live app + both rails
```

An unpaid `POST /api/x402/commission` answers `402` with signed requirements in the
`PAYMENT-REQUIRED` header, carrying the bazaar discovery extension so the resource is
indexable once a payment settles through the facilitator. A build that fails to go live
returns non-2xx, so **the facilitator never settles and the agent is not billed for an
app that did not ship**.

## Safety

- The agent runs a **fixed, named step list** — never a shell command composed from user
  text. Model-generated code only ever executes inside a Firecracker microVM.
- **Egress is deny-by-default** in the sandbox: npm, Stripe, the facilitator and the
  model API, nothing else.
- Generated apps receive **no secrets**; declared sandbox `envs` cannot be added to at
  exec time.
- Order polling is **read-only** — an order only becomes `complete` through the verified
  webhook, so the deliverable cannot be obtained without paying.
- Hard wall-clock budget per build, and a per-build supplier spend cap.
- The Stripe webhook verifies against the **raw** body and refuses outright when no
  signing secret is present. Idempotency comes from a unique index on
  `(provider, external_id)`, so replays post nothing and re-fulfil nothing.

## Tech

Next.js 16 · TypeScript · Tailwind 4 · Drizzle + SQLite · `@x402/next` 2.28 with the
bazaar extension · `@nodeops-createos/sandbox` · Stripe · AI SDK 7 + Claude · MCP over
streamable HTTP.

## Known limitations

Stated plainly, because a demo that hides these is worse than one that admits them:

- **One template family.** The app *skeleton* is fixed (text in → structured deliverable
  out); the product, branding, output shape and fulfilment prompt are generated. Briefs
  asking for uploads, accounts or multi-step flows are reduced to what is actually built.
- **The agent rail is priced per platform, not per build.** The x402 gateway advertises
  one price for all generated apps, so a per-build override would misquote it.
- **x402 defaults to Base Sepolia.** Flip `X402_NETWORK` to `eip155:8453` for mainnet;
  mainnet settlement wants a CDP-credentialed facilitator.
- **Bazaar listing follows settlement.** A resource is indexed after it settles a payment
  through a facilitator that indexes bazaar metadata — there is nothing to submit.
- **CreateOS Free plan runs one concurrent sandbox** and paused boxes still count against
  the cap, so concurrent builds reclaim each other's slots. Set
  `CREATEOS_MAX_CONCURRENT_SANDBOXES` to your plan's real limit.
- **Single-process SSE.** The timeline fan-out is in-memory; events are persisted first,
  so a reconnect replays correctly, but a multi-instance deploy would need a shared bus.
- **Every rail is mandatory.** There is deliberately no offline or demo mode, so the app
  cannot be exercised end to end without real credentials for the model, CreateOS, Stripe
  and an x402 payee.

## Docs

- [`docs/setup.md`](docs/setup.md) — the credential checklist, in order
- [`docs/paybox.md`](docs/paybox.md) — what PayBox does here, and the one thing it deliberately does not
- [`docs/architecture.md`](docs/architecture.md) — why these choices, and what was rejected
- [`docs/demo-script.md`](docs/demo-script.md) — both demo runs, shot by shot
- [`docs/submission-checklist.md`](docs/submission-checklist.md) — what is done and what needs an account

## License

MIT
