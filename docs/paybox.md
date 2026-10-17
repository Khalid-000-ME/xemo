# PayBox: what it does here, and how to ship it

**PayBox is not an unwanted integration — it is the entire second submission.** But the
direction matters, and an earlier version of this plugin was built in the wrong shape.
Both points are recorded here.

---

## The correction: PayBox hosts the plugin, it does not call a URL

The first implementation packaged Xemo the way `moonpay/paybox-plugin` is packaged
— a `.grok-plugin/plugin.json` plus a `.mcp.json` pointing at a hosted MCP server. That
is how PayBox ships **its own** plugin to agent hosts. It is **not** what the hackathon
accepts.

Per the [developer guide](https://developer.paybox.sh/requirements.md), a marketplace
plugin is:

> a standard TypeScript MCP server, bundled into a single `dist/plugin.mjs`, then
> uploaded, configured, and tested in the developer portal.

PayBox runs that bundle **in its own sandbox**. You upload a file; you do not expose a
server. `paybox-plugin/` has been rebuilt on the official v1.0.2 starter, with its pinned
toolchain and conformance harness.

## Direction 1 — inbound: agents pay *us*. This is the submission.

A PayBox-connected agent commissions a build and gets a deployed app back. Xemo
is the **merchant**; the agent's wallet, passkey and approval are all on their side.

| Piece | Where |
|---|---|
| Plugin bundle | `paybox-plugin/dist/plugin.mjs` |
| x402-gated build endpoint | `POST /api/x402/commission` |
| x402 agent rail on every generated app | `POST /api/x402/apps/[buildId]` |
| Bazaar discovery declaration | both routes, via `declareDiscoveryExtension` |
| Public catalogue | `GET /api/builds` |

**No PayBox credential is needed on the server side.** Being a correct x402 resource
server is the whole integration.

## Direction 2 — outbound: we pay other services. Deliberately not built.

An outbound client existed and was deleted: nothing imported it, the submission is the
inbound direction, and the cost it was meant to pay — model inference — is not sold over
x402. Booking real token usage against a rate card is honest and simpler.

---

## The three tools

| Tool | Network? | What it does |
|---|---|---|
| `commission_app` | **No** | Returns an unsigned **x402 proposal**. Nothing is paid here. |
| `get_build` | Yes | Status, URLs and economics of a build. Read-only, free. |
| `list_apps` | Yes | Everything Xemo has deployed. Read-only, free. |

`commission_app` makes no network call at all — it builds a proposal and returns it.
PayBox fetches the live 402, checks it against the proposal, and pays only with the
user's approval. The plugin never sees a key, a wallet or a signature.

### Why the paid request does not wait

A hosted operation gets **ten seconds**. A build takes longer. So the proposal carries
`"wait": false`: the endpoint validates the request shape and every required rail, accepts
the job, and returns a `buildId`. The agent then polls `get_build`, which is also how to
recover the result if the response is lost — rather than paying a second time.

---

## Two configuration facts that will bite you

### 1. The chain must be Base mainnet

PayBox accepts an x402 proposal on **`eip155:8453` (Base mainnet)** or
**`solana:mainnet`** — and nothing else. Base **Sepolia is not supported**.

The platform's own `X402_NETWORK` must match what the plugin proposes, or PayBox's check
of the live 402 against the proposal fails. So for the PayBox submission:

```env
X402_NETWORK=eip155:8453
X402_COMMISSION_PRICE_USD=0.05   # real money — keep it small
```

That means a little **real USDC on Base**, in the wallet credential you demo with. At
$0.05 a build, a full rehearsal plus the recording costs well under a dollar. The USDC
contract the proposal names is `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`.

**And mainnet needs a credentialed facilitator.** The public `x402.org/facilitator` is
testnet only — it settles Base Sepolia and will refuse `eip155:8453`. Get free API
credentials from <https://portal.cdp.coinbase.com> (CDP offers fee-free USDC settlement
on Base) and set:

```env
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
```

With those present the platform selects the CDP facilitator automatically; without them
the x402 routes answer `503` naming exactly this. Verify before recording:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/x402/commission" \
  -H 'content-type: application/json' -d '{"prompt":"check","wait":false}'
# 402 = ready to be paid.  503 = read the body; it names the variable to set.
```

> The CreateOS × Stripe submission is unaffected and can stay on Sepolia. These are two
> different recordings; set the variable for whichever you are filming.

### 2. The platform must be publicly reachable over HTTPS

PayBox's sandbox calls your API. `localhost` is unreachable from it, and `proposeX402`
rejects any non-HTTPS URL outright. You need a public origin for:

- `NEXT_PUBLIC_APP_URL` (payment requirements and generated apps are built from it),
- `XEMO_API_URL` (the plugin variable, set in the portal),
- the portal's **network access** allowlist — exact hostname, no wildcards.

---

## Setting it up

### Build the bundle

```bash
cd paybox-plugin
pnpm install --frozen-lockfile
pnpm test        # typecheck, build twice, require identical bytes, run conformance
```

A pass prints `"status":"passed"` with the artifact's size and sha256. Upload
**`dist/plugin.mjs`** — not the source, not a zip.

The conformance sample is `commission_app`, chosen because it makes no network call, so
the hosted check cannot fail for a reason unrelated to the plugin.

### Configure it in the portal

Under **Test & configure**:

- **Network access** → add your platform's exact hostname (no scheme, no wildcard).
- **Variables** → `XEMO_API_URL` = `https://your-deployment`

No secrets are required. Xemo's API needs no credential from the plugin: the
commission endpoint is paid for with x402, and the read endpoints are public.

### Account prerequisites

1. <https://app.paybox.sh> — account, **passkey**, and MoonPay KYC with a matching email.
2. A wallet credential funded with **USDC on Base**, granted to the connector you demo
   with. Choose the approval mode deliberately: `autonomous` records smoothly,
   `always_approve` shows the passkey step, which tells a better story.

> x402 needs a plain EOA payer. If the wallet is still EIP-7702 delegated, `pay_x402`
> either errors or undelegates first — worth knowing before it happens on camera.

---

## Should this be a separate submission?

**Separate submission, same app.** Do not fork the product. The two hackathons want
different things *emphasised*, not different software:

- **CreateOS × Stripe** → the agent writing and running code in a sandbox, deploying, and
  taking a Stripe payment.
- **PayBox** → the plugin bundle and the x402-gated service.

`paybox-plugin/` is already a self-contained artifact and is the only thing a PayBox judge
needs to read. One engine, two front doors — say that rather than hiding it.

---

## About the Bazaar listing

There is nothing to submit. A resource is indexed after it **settles** a payment through
a facilitator that indexes bazaar metadata, which is why the declaration lives in the 402
challenge and why settling one real payment is what gets Xemo listed.
