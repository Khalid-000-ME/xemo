# Architecture notes

What was chosen, and what was rejected. The rejected options matter more than the chosen
ones — most of them are the obvious first answer.

## Deployment: sandbox ingress, not a repo-based deploy

CreateOS has two ways to put an app online: a GitHub-linked project deploy, and a Sandbox
with `ingress_enabled: true` that hands back a per-sandbox HTTPS URL.

**Chosen: sandbox ingress.** A build creates no repository, waits in no build queue, and
has a public URL seconds after the server starts. Paused sandboxes keep their disk and
wake on the next request to their ingress hostname, so a published app survives teardown
at no compute cost.

**Rejected: repo-based deploy.** It would mean creating a GitHub repo per build,
authorising it, and waiting on a remote build — three failure modes and minutes of
latency, for a URL that is no more public than the one ingress already gives.

One wrinkle this forced: a freshly provisioned ingress hostname can serve before its TLS
certificate lands, so `serve()` probes `https` and falls back to `http` rather than
handing back a URL that fails in a browser.

## The generated app holds no secrets

The obvious design gives the generated app its own Stripe key and model key. That is what
makes it a real standalone app.

**Chosen: the platform is merchant of record.** The generated app posts buyer input to
the platform and gets a Checkout URL back; the platform captures payment, runs inference
and writes the ledger. The app is a storefront and a fulfilment surface.

Three things fall out of that, all of them good:

1. The app needs **zero dependencies**, so `npm install` cannot fail a deploy.
2. No credential ever reaches model-generated code. Sandbox `envs` are declared at create
   time and per-exec overrides cannot introduce new keys, so this is enforced by the
   platform, not by our care.
3. There is exactly **one** x402 resource server in the system, using the real typed
   library, instead of a hand-rolled verifier copied into every generated app.

The cost is honesty about what the app is: a branded storefront backed by a shared
backend, not a self-contained business. The README says so.

## Codegen: template + substitution, with a hard failure on placeholders

A model writing a whole application live is a coin flip, and a 5½-hour event is the wrong
place to flip it.

**Chosen:** the skeleton is fixed and reviewed; the *product* is generated — name,
positioning, the deliverable's fields, the fulfilment prompt, the build steps. Rendering
asserts that no `{{PLACEHOLDER}}` survives, because a half-rendered app is worse than a
failed build.

This is also what keeps the demo honest. The thing being demonstrated is not "a model can
write a web server"; it is that the shipped app has two working payment rails.

## Execution: a named step list, not model-authored commands

The agent cannot compose a shell command. It picks from `BUILD_STEPS` by name —
`install`, `typecheck`, `test` — so prompt text never reaches a shell even though the
shell is inside a disposable microVM. Egress is allowlisted before any generated code
runs, which makes the deny-by-default rule a property of the sandbox rather than a
promise in a prompt.

## No simulated paths

An earlier revision degraded gracefully: a deterministic planner when no model key was
present, a local child-process runner instead of a microVM, a checkout URL that took no
money. It made the product demoable with zero credentials.

**That was removed deliberately.** The failure it invites is worse than the one it
prevents: a funnel that looks like it worked, and a margin figure assembled from list
prices nobody paid. A demo that quietly shows simulated revenue is not a smaller claim,
it is a false one.

So every rail is required, and the design absorbs that in three places:

- `readiness()` reports which rails are wired, and which of them block a build. The home
  page and `/api/capabilities` read the same function, so they cannot disagree.
- `requireBuildReady()` throws `MissingCredentialsError` **before** any work or spend,
  listing the exact environment variables. Request shape is validated first, so a
  malformed brief reports the malformation rather than sending the caller after a key.
- On the x402 routes a missing credential is a deliberate non-2xx. The facilitator never
  settles on a non-2xx, so an agent is never charged because the operator left a key
  unset.

The cost is that the app cannot be exercised at all without real credentials. The README
says so under known limitations.

## Costs are measured, not estimated

Inference is booked from the token usage the provider reports, priced against a rate card
in `src/lib/pricing.ts`; a model absent from that table throws rather than being assigned
a plausible number. Compute is booked from real sandbox seconds against the published
CreateOS vCPU and GiB rates. There is no `settled` column any more, because with nothing
simulated there is no such thing as a row that was recorded but not paid.

## x402: one resource server, bazaar registered

`@x402/next` 2.28 with `ExactEvmScheme` and `bazaarResourceServerExtension`. Two resources
are sold: `/api/x402/commission` (a build) and `/api/x402/apps/[buildId]` (a call to a
built app).

`withX402` rather than `paymentProxy`, deliberately: it settles **only** after a handler
returns < 400. So a build that fails to go live returns 502 and the facilitator never
settles — the agent is not billed for an app that did not ship. With `paymentProxy` they
would have been.

Discovery is declared with `declareDiscoveryExtension`, which is how a resource becomes
indexable. There is no listing to submit: a facilitator indexes a resource after it
*settles* a payment carrying bazaar metadata.

Note the shapes, both of which differ from what the surrounding documentation suggests:
the HTTP method is omitted from the declare input (the resource server fills it in via
`enrichDeclaration`), and `serviceName` / `tags` / `iconUrl` sit at the top level of
`RouteConfig`, not nested under `resource`.

## PayBox: merchant first, spender second

The original plan had Xemo implement OAuth 2.1 + PKCE as a PayBox *client*. That
is hours of work for a role this product does not have.

**Chosen:** Xemo is primarily the merchant. PayBox-connected agents are the
customers, so all that is required is being a correct x402 resource server. The MCP tools
quote and never spend; `pay_x402` on the agent's side does the paying, keeping authority
with PayBox and the user's passkey.

An **outbound** client existed briefly — a real implementation against
`api.paybox.sh/mcp` that called `use_service` so Xemo could buy from other x402
endpoints. It was deleted, because nothing imported it: the submission is the inbound
direction, and the cost it was meant to pay (model inference) is not sold over x402
anyway. Booking real token usage against a rate card is both honest and simpler. The
reasoning is written up in [paybox.md](paybox.md).

So PayBox requires **no credential on this side at all**. Being a correct x402 resource
server is the whole integration, which is exactly what PayBox's "wrap your endpoint"
promise means.

## Storage: libSQL with DDL at boot

Drizzle over `@libsql/client`. Locally `DATABASE_URL` is a file, and on Vercel it is a
remote Turso `libsql://` URL, because the Vercel filesystem is ephemeral (the client refuses
a file database when `VERCEL` is set). The schema is applied as idempotent
`CREATE TABLE IF NOT EXISTS` DDL at server start (`src/instrumentation.ts`). There is no
migration command to forget under time pressure, and the schema is small enough that
`IF NOT EXISTS` is honest rather than a dodge.

The ledger is the one piece with real integrity requirements, so it gets a unique index on
`(provider, external_id)`. That single index is what makes Stripe webhook replays and x402
retries safe, rather than application-level de-duplication that races.

One consequence worth stating: a generated app calls the platform's public URL, so that
platform must read the database the build was written to. A local server whose
`NEXT_PUBLIC_APP_URL` points at a deployment must therefore share that deployment's
database. `readiness()` flags the mismatch.

## SSE: persist, then poll

Build events are written to the database as they happen, and the stream route reads them
back, polling once a second and resuming from `?after=N`. That is why a reconnect is exact
with neither a gap nor a duplicate, and why it works across serverless instances: there is
no in-process bus to lose. Background build work continues after the response returns by
using `after()` from `next/server`.
