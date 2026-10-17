---
name: appfactory-commission-apps
description: Judgement for commissioning a deployed micro-SaaS through AppFactory — quoting before paying, writing a brief that produces a good product, and waiting out a build that takes minutes. Use when the user wants an app, a tool, a paid service or a product built and put online.
license: MIT
---

# Commissioning an app without surprising the user

AppFactory tools are read-only. They quote; they never spend. The payment itself goes
through PayBox `pay_x402`, which is what puts the user's passkey in the loop.

## Always quote first

Call `quote_app_build` with the user's brief and **tell the user `priceUsd` before you
pay anything**. One build is one payment. If the user asks for three variations, say that
it is three payments and what the total will be, before the first one.

`quote_app_build` returns the `resource`, the `method`, the exact `body` to send, and the
`network`. Use those values verbatim rather than reconstructing them.

## The order of operations

1. `quote_app_build` — get terms and price.
2. Tell the user the price. Wait if they have not clearly asked you to proceed.
3. `pay_x402` with the quoted `resource` to obtain the `X-PAYMENT` header.
4. `POST` the quoted `body` to the quoted `resource` with that header.
5. Report the `appUrl`, the `agentEndpoint`, and the build's economics.

Never skip step 3 and POST unpaid hoping for a result — you will get a `402` and have
learned nothing you could not have read from the quote.

## A build takes minutes, not seconds

Expect 60–180 seconds for the paid POST to return. That is the real work: planning,
generating, installing, syntax-checking, running a smoke test against a live server boot,
publishing, and provisioning Stripe. Do not time out early and do not retry — a retry is
a second payment for a build that is probably still running. If you lose the response,
use `list_apps` or `get_build` to recover it rather than paying again.

## What makes a good brief

The brief becomes the product, so vagueness becomes a vague product. A good brief names:

- **what the input is** — AppFactory's apps take one block of pasted text,
- **what the buyer gets out** — a score, a list, a rewrite, a verdict,
- **what a human pays** — `priceUsd`, between $1 and $100.

> Build a paid cold email auditor for founders. Charge $4 per audit. Score reply
> likelihood, flag spam triggers, and rewrite the opening line three ways.

Briefs that ask for accounts, file uploads, dashboards, multi-step flows or third-party
integrations will be reduced to what the platform actually builds. Say so rather than
promising the user something the build will not contain.

## A failed build is not billed

If the POST returns a non-2xx, the facilitator never settles: the user paid nothing. Read
the error, fix the brief, and quote again. Do not describe a failed build as a charge.

## Two rails, and say so

Every app AppFactory ships sells twice: humans buy through Stripe Checkout at `appUrl`,
and agents buy through x402 at `agentEndpoint`. When you hand the result back, give the
user both — the second one is the part they will not expect.
