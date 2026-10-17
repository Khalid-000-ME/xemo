# PayBox: what it does here, and what it does not

Short answer: **PayBox is not an unwanted integration — it is the entire second
submission — but it needs no PayBox credential on the server side, and the one piece that
would have needed credentials has been removed because nothing called it.**

The confusion is worth naming precisely, because PayBox can touch an app in two opposite
directions and only one of them is ours.

---

## Direction 1 — inbound: agents pay *us*. This is the submission.

A PayBox-connected agent discovers AppFactory, pays for a build, and gets a deployed app
back. Here AgentFoundry is the **merchant**. The agent's wallet, the agent's passkey, the
agent's approval — all on their side.

What that requires from us is already built:

| Piece | Where | Needs a PayBox credential? |
|---|---|---|
| x402-gated build endpoint | `POST /api/x402/commission` | **No** |
| x402 agent rail on every generated app | `POST /api/x402/apps/[buildId]` | **No** |
| Bazaar discovery declaration | both routes, via `declareDiscoveryExtension` | **No** |
| MCP server the plugin points at | `GET`/`POST /api/mcp` | **No** |
| The marketplace plugin package | `paybox-plugin/` | **No** |

This works because PayBox speaks x402 natively. Its own developer page puts it plainly:
wrap your endpoint and it works inside PayBox without a bespoke integration. The server
side of that is just *being a correct x402 resource server* — which is what
`src/lib/x402/server.ts` is.

**So: no `PAYBOX_API_KEY` is needed to ship, run, or demo the plugin.**

## Direction 2 — outbound: we pay other services. This was unwanted, and is gone.

`src/lib/paybox/client.ts` used to exist: a real client that called PayBox's
`use_service` so AgentFoundry could buy from other x402 endpoints. It worked, and it was
**imported nowhere**. It has been deleted, for four reasons:

1. **The hackathon asks for the opposite direction.** The requirement is a live plugin
   that works end to end. Being a *consumer* of PayBox demonstrates nothing about our
   plugin.
2. **It needed credentials the submission does not.** `PAYBOX_API_KEY` plus
   `PAYBOX_CREDENTIAL_ID`, and nothing in the build path used them.
3. **The cost it was meant to pay is not an x402 service.** The original plan had the
   agent "pay for inference through x402". Anthropic does not sell inference over x402.
   What we do instead is honest and better: call the API directly and book the **real**
   token cost from the usage the provider reports. That is where the margin number comes
   from.
4. **It was a demo liability.** Real money per call, and a passkey tap mid-recording if
   the credential's approval mode is not autonomous.

It is recoverable from git history if ever wanted.

> **The one genuinely nice outbound shot needs no code from us.** "The agent buys from
> the app it just built" is a great 10 seconds — and the agent does that with *PayBox's
> own* `pay_x402` against our `agentEndpoint`. Our side is the merchant for that call
> too.

---

## Should this be a separate submission, or a separate app?

**Separate submission, same app.** Do not fork the product.

The two hackathons want different things *emphasised*, not different software:

- **CreateOS × Stripe** → the agent writing and running code in a sandbox, deploying, and
  taking a Stripe payment. Point the judges at `/`, a build timeline, and `/dashboard`.
- **PayBox** → the marketplace plugin and the x402-gated service. Point the judges at
  `paybox-plugin/` and `/api/x402/commission`.

The repository is already structured for that: `paybox-plugin/` is a self-contained
artifact with its own README and skills, and it is the only thing a PayBox judge needs to
read. One engine, two front doors — which is also the strongest thing you can say about
the project, so say it rather than hiding it.

---

## Setting up PayBox

Nothing here is a server credential. All of it is so **you can act as the buyer** in the
demo and so you are eligible to submit.

### 1. Account, passkey, KYC — required to submit

1. <https://app.paybox.sh> → sign up with email and register a **passkey**.
2. Complete MoonPay onboarding/KYC. Winners must clear KYC/AML within five business days,
   and the terms require the featured product's account setup before submitting — so do
   this early, not after you record.

### 2. A funded wallet, so a payment can actually settle

The demo's most important second is a real `402` turning into a real settlement. For
that, the *agent* needs funds on the network our endpoint advertises
(`X402_NETWORK`, currently Base Sepolia):

1. In PayBox, connect or create a wallet credential.
2. Fund it with **Base Sepolia USDC** from <https://faucet.circle.com>, plus a little
   Base Sepolia ETH for gas.
3. Grant that credential to the connector you will demo with, and set its approval mode.
   `autonomous` records more smoothly; `always_approve` shows the passkey step, which is
   a better story. Pick one and rehearse it.

> x402 needs a plain EOA payer. If the wallet is still EIP-7702 delegated, `pay_x402`
> either errors or undelegates first where that is enabled — worth knowing before it
> happens on camera.

### 3. An agent host with both plugins

The plugin is packaged for **Grok**, matching `moonpay/paybox-plugin`.

1. Install the official **PayBox** plugin in your agent host and sign in — this is what
   provides `pay_x402`, `use_service` and `discover_services`.
2. Install **AppFactory**: point `paybox-plugin/.mcp.json` at your deployed URL first.

```json
{
  "mcpServers": {
    "appfactory": { "type": "http", "url": "https://your-deployment/api/mcp" }
  }
}
```

### 4. Verify before you record

```bash
# our MCP server answers
curl -s -X POST https://your-deployment/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'

# the 402 an agent will receive, decoded
curl -sD - -o /dev/null -X POST https://your-deployment/api/x402/commission \
  -H 'content-type: application/json' -d '{"prompt":"a paid resume reviewer"}' \
  | grep -i '^payment-required:' | sed 's/^[^:]*: //' | tr -d '\r' | base64 -d | jq
```

The decoded challenge must show your own `payTo`, the right `network`, an `amount` in
atomic units, and `extensions.bazaar`. If `payTo` is not your address, fix
`X402_PAY_TO` — payments would go somewhere you do not control.

### 5. Then ask the agent, in one sentence

> "Use AppFactory to build me a paid cold email auditor that charges $4 an audit."

A well-behaved agent will call `quote_app_build`, tell you it costs $0.50, pay with
`pay_x402` once you approve, POST the resource, and hand back a live URL. That is the
whole video.

---

## About the Bazaar listing

There is nothing to submit. A resource is indexed after it **settles** a payment through
a facilitator that indexes bazaar metadata — which is why the declaration lives in the
402 challenge and why settling one real payment is what gets AppFactory listed. Do the
paid call at least once, on the network you intend to be listed on.
