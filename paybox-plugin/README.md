# AppFactory plugin

[AppFactory](https://github.com/Khalid-000-ME/xemo) turns one sentence into a deployed,
revenue-generating micro-SaaS. This plugin connects your agent to it.

Describe a product. AppFactory plans it, generates it, tests it inside a Firecracker
microVM, publishes it to a public URL, and opens **two** payment rails on the finished
app: Stripe Checkout for human buyers, and an x402 endpoint so other agents can buy it
too. It then reports what that app earned, what it cost, and the margin between them.

AppFactory is itself sold over [x402](https://x402.org), so PayBox pays for a build the
same way it pays for any other paid endpoint. No bespoke integration.

## Install

Add the plugin from your host's plugin marketplace. Before first use, set the MCP URL in
`.mcp.json` to your deployed AppFactory instance.

Currently packaged for **Grok**, matching the layout of the
[official PayBox plugin](https://github.com/moonpay/paybox-plugin).

## What it adds

**MCP server** — your AppFactory deployment's `/api/mcp`, providing:

| Tool | Purpose |
|---|---|
| `quote_app_build` | Return the x402 terms and the price for a build. Read-only; spends nothing. |
| `get_build` | Status, URLs and economics of a build. |
| `list_apps` | Everything AppFactory has deployed. |

All three are read-only. **AppFactory never spends on your behalf** — it quotes a price
and hands you the terms, and PayBox's `pay_x402` does the paying. That split is
deliberate: payment authority stays with PayBox and the user's passkey.

**Skills**

| Skill | Use it for |
|---|---|
| `appfactory-commission-apps` | Quoting, paying and waiting out a build without surprising the user |
| `appfactory-operate-apps` | Reading a deployed app's economics, and buying from one |

## How a build is paid for

```
quote_app_build          → terms + priceUsd   (nothing spent)
tell the user the price
pay_x402 on the resource → X-PAYMENT header   (user approves in PayBox)
POST the resource        → live app + both rails
```

An unpaid `POST` to the resource answers `402 Payment Required` with signed payment
requirements in the `PAYMENT-REQUIRED` header. A build that fails to reach a live state
returns a non-2xx, so the facilitator never settles and **you are not billed for an app
that did not ship**.

## Security

- AppFactory holds no wallet and no card. It is a merchant, not a spender.
- Generated apps are given no API keys; the platform is merchant of record for them.
- Model-generated code runs in a Firecracker microVM with a deny-by-default egress
  allowlist, never on the platform host.
- A build has a hard wall-clock budget and a per-build supplier spend cap.

## Links

- [Source](https://github.com/Khalid-000-ME/xemo)
- [x402](https://x402.org) · [PayBox docs](https://docs.paybox.sh)

## License

MIT — see [LICENSE](../LICENSE).
