# Submission checklist

`[x]` built and verified · `[ ]` needs an account, a key, or a recording

## Both submissions

- [x] Public repository with real incremental commit history
- [x] README with architecture, setup and honest limitations
- [x] `.env.example` documenting every variable
- [x] No secrets committed (`.env*` gitignored, `.env.example` excepted)
- [x] MIT licensed
- [x] `pnpm build` clean, `pnpm typecheck` clean, `pnpm smoke` 32/32
- [ ] **Repository made public** — it is private right now, and CreateOS requires a public repo
- [ ] Credentials filled in per [`setup.md`](setup.md)
- [ ] Deployed to a public URL, with `NEXT_PUBLIC_APP_URL` pointing at it

## CreateOS × Stripe

- [x] Agent plans and generates application code
- [x] Agent executes commands in a CreateOS sandbox — `npm install`, syntax check, smoke test
- [x] Deployment through CreateOS, on per-sandbox public HTTPS ingress
- [x] Stripe product, price and Checkout session created by the agent
- [x] Stripe webhook verified against the raw body, idempotent on replay
- [x] Dashboard shows revenue, cost of goods and measured margin
- [x] Started from an empty directory
- [ ] Stripe Projects used to provision — `stripe projects add createos/project`
- [ ] A test payment completed end to end on the deployed instance
- [ ] Demo video recorded ([script](demo-script.md))
- [ ] Submitted to the Stripe Projects leaderboard before 7:00 PM PT

## PayBox Chapter 1

- [x] Plugin built on the official v1.0.2 hosted-runtime starter
- [x] `pnpm test` passes — typecheck, deterministic double build, conformance
- [x] Bundle is 398 KB, well under the 10 MiB cap
- [x] Tools are read-only and quote rather than spend
- [x] x402-gated endpoint returns `402` with signed payment requirements
- [x] Bazaar discovery extension declared, with input and output schemas
- [x] A failed build returns non-2xx, so the facilitator never settles
- [x] Plugin returns both the app URL and the human checkout
- [x] No PayBox server credential required — merchant side only (see `paybox.md`)
- [ ] PayBox account created, passkey registered, KYC completed
- [ ] A wallet credential funded with Base Sepolia USDC, to act as the buyer on camera
- [ ] `XEMO_API_URL` + network-access hostname set in the portal
- [ ] `X402_NETWORK=eip155:8453` (PayBox rejects Sepolia proposals)
- [ ] `dist/plugin.mjs` uploaded and hosted preflight passed
- [ ] One x402 payment actually settled against the endpoint
- [ ] Demo video posted to X ([script](demo-script.md))
- [ ] Submitted via `developer.paybox.sh` before **8:00 PM EDT, Sat 17 Oct**
- [ ] AI assistance disclosed where the rules require it

## Verification commands

```bash
pnpm smoke                                   # every rail + 32 assertions
BASE=https://your-deployment pnpm smoke      # same, against the deployment

# the 402 challenge a PayBox agent will see
curl -sD - -o /dev/null -X POST $BASE/api/x402/commission \
  -H 'content-type: application/json' -d '{"prompt":"a paid stablecoin reserve risk checker"}' \
  | grep -i '^payment-required:' | sed 's/^[^:]*: //' | tr -d '\r' | base64 -d | jq

# the MCP handshake the plugin performs
curl -s -X POST $BASE/api/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

## Order of operations on the day

1. Fill in credentials, `pnpm smoke` until every rail is green.
2. Deploy; set `NEXT_PUBLIC_APP_URL`; `pnpm smoke` against the deployment.
3. Make the repository public.
4. Run one build end to end, pay it with the Stripe test card.
5. Record the CreateOS × Stripe video.
6. Point `.mcp.json` at the deployment; settle one x402 payment.
7. Record the PayBox video; post to X.
8. **Submit PayBox first** — its deadline lands before the CreateOS demos.
