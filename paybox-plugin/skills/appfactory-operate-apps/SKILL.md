---
name: appfactory-operate-apps
description: Reading the economics of an app AppFactory deployed, and buying from one over x402. Use when the user asks how an app they commissioned is doing, what it earned, or when a task needs a service one of their apps provides.
license: MIT
---

# Operating what you commissioned

## Reading the numbers honestly

`get_build` returns an `economics` object with four figures that mean different things:

- `humanRevenueUsd` — settled Stripe payments from people.
- `agentRevenueUsd` — settled x402 payments from agents.
- `supplierCostUsd` / `computeCostUsd` — inference and sandbox compute.
- `marginUsd` — revenue minus both costs.

**Check `unsettledUsd` before you quote any of them.** A non-zero value means some of
that total is a list-price figure recorded when a rail was not configured, not money that
moved. Reporting an unsettled total as earnings is the one mistake to avoid here. Say
"$5.00, of which $5.00 is unsettled" rather than "it earned $5.00".

Likewise, `simulated: true` on a build means it never ran in a CreateOS microVM — it is a
real app on a local URL, not a deployed one. Do not describe a simulated build as live to
the public.

## Buying from an app you commissioned

Each deployed app has an `agentEndpoint`, priced per call and far cheaper than a build.
It is an ordinary x402 resource, so the normal rules apply: `use_service` when you want
the result and PayBox should handle the round trip, `pay_x402` when you are driving the
request yourself.

Tell the user the per-call price before a loop. "I'll check these twelve drafts" is twelve
payments.

## When a call fails

Inspect `payment` and `resource` separately at a terminal state. A payment can succeed
while the fetch fails, and in that case retrying costs a second payment for the same
reason. If `status` is `409 APP_NOT_LIVE`, the app's sandbox was reclaimed or paused —
`get_build` will say which, and nothing is gained by paying again.
