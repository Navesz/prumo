# 0011 — oRPC instead of ts-rest

**Status:** Accepted, 2026-08-24. Supersedes the contract row of `PLANO.md` §4.

## Context

The plan inherited `ts-rest` from the Herz stack document, for a good reason that
still holds: a Zod schema on its own describes a _payload_, not an _API_. It has no
method, no path, no status codes and no error shape, and that gap is exactly where a
generated client invents `POST /pedido/iniciar` while the server is waiting on
`POST /pedidos/:id/iniciar-montagem`. tRPC was rejected for the opposite reason — it
erases the HTTP semantics (402 vs 409 vs 422 vs 429) that in this product **are** the
feature.

Herz never hit the problem below, because the Herz backend was never built.

Checked against the npm registry on 2026-08-24:

| Fact                                      | Value                             |
| ----------------------------------------- | --------------------------------- |
| `@ts-rest/fastify` peer dependency        | `fastify: ^4.0.0`                 |
| Latest published `@ts-rest/fastify`       | 3.52.1, published 2025-03-04      |
| Newest release candidate                  | 3.53.0-rc.1, published 2025-06-02 |
| Peer dependency in that release candidate | still `fastify: ^4.0.0`           |
| Current Fastify                           | 5.12.1                            |

So the adapter pins a major version of Fastify that is two years behind, the last
stable release is seventeen months old, and even the newest pre-release did not move.
Installing it against Fastify 5 requires overriding a peer dependency and hoping the
plugin API did not drift — in the one layer whose entire job is to make drift a
compile error.

## Decision

Use **oRPC** (`@orpc/contract`, `@orpc/server`, `@orpc/openapi`, `@orpc/client`,
`@orpc/tanstack-query`), version 1.15.0, published 2026-08-23.

It keeps every property ts-rest was chosen for:

- **Contract-first.** `packages/contract` holds one object; the server implements it
  with `implement(contract)` and the browser client is built from the same object.
  Divergence is a compile error on both sides.
- **Real HTTP semantics.** `ORPCError` carries a `status` field, the standard codes map
  to 400/401/403/404/409/422/429/503, and `status` is overridable — which is how
  `CREDENTIAL_NO_CREDIT` gets 402, a code the standard map does not include.
- **OpenAPI generated FROM the contract**, never the other way around.
- **Official Fastify adapter** (`@orpc/server/fastify`, `@orpc/openapi/fastify`) and an
  official TanStack Query integration.

`npm install` resolves with no peer conflicts and no overrides.

## Consequences

The contract package depends on Zod **4**, not Zod 3. The plan's note that "Zod 4
stays out until ts-rest declares support" was correct at the time and is now moot:
ts-rest was the only thing holding Zod 3.

### What we give up

- A smaller community than ts-rest had at its peak, and less written-down folklore to
  search when something behaves oddly.
- The `.route({ method, path })` paths are honoured by the OpenAPI handler, not by the
  RPC handler. Choosing the OpenAPI handler for the browser costs a little payload size
  compared with the RPC protocol, and buys a public REST surface that an agent can read.
- One more thing that can go stale. This ADR exists so the next person can see the
  criterion rather than the conclusion.

## Reconsider if

- `@orpc/*` goes twelve months without a release while a Fastify major ships, which is
  the exact shape of the failure being avoided here; or
- the OpenAPI handler's payload size shows up in a **measured** mobile page load, in
  which case the browser moves to `RPCHandler` at `/rpc` and the OpenAPI handler stays
  mounted at `/api` for public and agent use. Both are the same contract, so that is a
  transport change, not a rewrite.
