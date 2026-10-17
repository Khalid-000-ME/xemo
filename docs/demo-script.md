# Demo scripts

Two recordings from one engine. Record them in this order — the CreateOS run produces
the live app that the PayBox run then buys from.

Before either: run `pnpm smoke` and confirm every rail reads `●`. A rail that is missing
will refuse mid-demo, by design.

---

## 1. CreateOS × Stripe — 100 seconds

**What has to be visible on screen:** the agent planning, generating files, running
commands in a CreateOS sandbox, deploying, and a Stripe payment completing.

| Shot | On screen | Say |
| --- | --- | --- |
| 0:00 | Home page, rails panel all green | "AgentFoundry. One prompt, and out comes a business that sells to humans *and* to agents." |
| 0:08 | Type the brief, press build | "Build a paid AI resume reviewer, five dollars a review." |
| 0:14 | Timeline: plan event expands, spec visible | "It writes the product spec first — the name, the positioning, what the buyer actually receives." |
| 0:24 | Timeline: four `Wrote …` events | "Then it generates the app." |
| 0:30 | `Install dependencies` → `Syntax-check` → `Run the smoke test` | "And here is the part that matters: it's executing in a CreateOS Firecracker microVM. npm install, a syntax check on every file, and a smoke test that boots the real server and asserts ten things against it." |
| 0:44 | `test passed`, then `Live at https://…sb.createos.sh` | "Tests pass, so it publishes — public HTTPS straight off the sandbox's ingress." |
| 0:52 | `Stripe product and price created` | "Stripe product and price, created by the agent." |
| 0:58 | `Agent rail open — $0.02 per call over x402` | "And an x402 endpoint, so other *agents* can buy this too." |
| 1:04 | Open the live app URL | "That's the deployed storefront." |
| 1:10 | Paste a resume, click pay, `4242 4242 4242 4242` | "Real Stripe Checkout." |
| 1:22 | Result page renders the review | "Payment confirmed by webhook, and the review comes back." |
| 1:32 | `/dashboard` | "Revenue on the left, cost of goods on the right — inference priced from the tokens it actually used, compute from real sandbox seconds. That's a measured margin, not an estimate." |
| 1:40 | Hold on the margin figure | "From one prompt to a product with proven unit economics." |

**Have ready:** a resume in your clipboard, `stripe listen` running, and the test card.

**If a build fails on camera**, don't hide it. The timeline shows the failing command and
its output, and a failed build never got a URL or a Stripe product — that's the safety
story working. Re-run it.

---

## 2. PayBox — AppFactory — 75 seconds

**Requirements:** a live plugin working end to end, and this video posted to X.

| Shot | On screen | Say |
| --- | --- | --- |
| 0:00 | `paybox-plugin/` tree in an editor | "AppFactory is a PayBox marketplace plugin. Same shape as PayBox's own: a manifest, an MCP server, and skills." |
| 0:08 | An agent with PayBox + AppFactory connected | "Any PayBox-connected agent can now commission real software." |
| 0:14 | Ask the agent: "build me a paid cold email auditor" | — |
| 0:20 | Agent calls `quote_app_build`; the quote shows `priceUsd: 0.5` | "First it quotes. AppFactory never spends — it hands back x402 terms and a price, and tells you the price before anything moves." |
| 0:30 | Agent calls PayBox `pay_x402`; approval appears | "PayBox does the paying. Scoped, revocable, and it's my passkey that authorises it — not the agent." |
| 0:40 | Approve; the paid POST goes out | "Now it pays the 402 and retries with the payment header." |
| 0:48 | Build runs; agent reports `appUrl` + `agentEndpoint` | "And it gets back a deployed app — with a Stripe checkout for people, and its own x402 endpoint for other agents." |
| 0:58 | Open the returned app URL | "That is a live, monetized product, commissioned and paid for by an agent." |
| 1:06 | Agent calls the new app's `agentEndpoint` | "And the agent can buy *from* what it just built. Two cents a call." |
| 1:14 | `/dashboard`, agent revenue row | "Agent commerce on both sides of the same ledger." |

**If approvals are slow on camera:** the x402 challenge itself is instant and worth
showing on its own — `curl` the endpoint, show the `402`, decode the `payment-required`
header, point at `serviceName`, `payTo` and the bazaar extension. That is the protocol
compliance a judge is checking.

---

## What to say about the limitations

Volunteer them; it reads as confidence and every judge finds them anyway.

- The app *skeleton* is templated — text in, structured deliverable out. The product,
  branding, output shape and fulfilment prompt are generated. Say so plainly: it is why
  a live deploy actually works on a clock.
- x402 is on Base Sepolia for the recording. One env var moves it to mainnet.
- Bazaar listing follows settlement, not submission — the resource is indexed once a
  payment settles through a facilitator that indexes bazaar metadata.
