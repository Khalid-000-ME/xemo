# {{PRODUCT_NAME}}

{{TAGLINE}}

Built and deployed by [Xemo]({{PLATFORM_URL}}) from a single prompt.
Build id: `{{BUILD_ID}}`.

## Two ways to buy

| Buyer | Route | Price |
| --- | --- | --- |
| A human | Stripe Checkout at `/` | ${{PRICE_USD}} per {{UNIT}} |
| An agent | x402 at `{{AGENT_ENDPOINT}}` | ${{AGENT_PRICE_USD}} per call |

The agent route speaks [x402](https://x402.org): an unpaid request answers
`402 Payment Required` with payment requirements, and a request carrying a valid
`X-PAYMENT` header is fulfilled.

## Running locally

```bash
npm install
npm run typecheck
npm test
npm start
```

## Design note

This app holds no API keys. Payment capture, model inference and the revenue
ledger live on Xemo, which acts as merchant of record; this service is
the branded storefront and fulfilment surface.
