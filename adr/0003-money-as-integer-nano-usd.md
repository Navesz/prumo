# ADR 0003: Money as integer nano-USD

- Status: Accepted
- Date: 2026-08-24

## Context

Money in Prumo is four things: a price in the catalogue, a spending cap, a reservation, and a ledger entry. All four are the same number in different rows, and the product is the _difference_ between two of them.

Prices span orders of magnitude that no single unit obviously covers. The catalogue's `base` enum has five values — per image, per megapixel, per step, per second, per output token — because providers genuinely charge that way: DeepInfra bills `$0.009 × (w/1024) × (h/1024) × (iters/25)`; Together bills FLUX1.1 [pro] per megapixel and schnell per image; BFL bills the first megapixel and adds the rest. A catalogue of "USD per image" computes the wrong number for at least five of the thirteen providers, and the router then picks the wrong route with confidence.

The house standard for money is integer cents. Herz uses a branded decimal string, `/^-?\d{1,15}(\.\d{1,4})?$/`, argued as "cents would force every consumer to know the scale; this format documents itself" (`planejamento/Stack.md:134-143`). Four decimal places bottoms out at $0.0001.

Neither works here.

**Cents kill the product.** There are images at US$ 0.0005. Two routes at $0.0031 and $0.0047 both truncate to $0.00 at cent granularity. The comparator's entire output becomes a tie, and a tie is the absence of the thing being sold. Herz's four decimals are better and still land one order of magnitude above the interesting differences once a per-megapixel formula is applied to a small image.

**A decimal string does not sum in SQL**, and here the budget invariant _is_ an arithmetic comparison inside a `WHERE` clause evaluated by Postgres (ADR 0007). Money that the database cannot add is money the database cannot enforce a cap on.

Nano-USD is not an invention. fal already reports `cost_estimate_nano_usd` in `GET /v1/models/billing-events` (fal platform API docs, read 2026-08-24; recorded in `docs/PROVEDORES.md`). One of the thirteen providers already settles in this unit.

## Decision

One money type across the whole system: **`bigint`, unit nano-USD, 1 = 1e-9 USD**. Columns are suffixed `_nano`: `budget.cap_nano`, `reserved_nano`, `spent_nano`, `generation.estimated_cost_nano`, `actual_cost_nano`, `ledger_entry.amount_nano` (signed), `price.value_nano_usd`.

Range: int8 tops out at 9.22e18 nano ≈ US$ 9.22 billion. Not a constraint for this product.

**No float on the money path, anywhere.** Not in the domain, not in a `jsonb` payload, not in a chart.

**Wire format is a decimal string of an integer**, branded in `packages/contract` and parsed by Zod: `"1300000"` is 1.3e6 nano = US$ 0.0013. JSON has no bigint, and `JSON.parse` produces a double — which is the exact type this ADR bans. `Number.MAX_SAFE_INTEGER` is 9.007e15, about US$ 9.0 million in nano-USD; a yearly ledger sum crossing that is not implausible for a shared instance, and it would lose precision with no error.

**Rounding is fixed here, once:** estimation rounds **up** to the next nano, so a reservation is never short. A provider's settled figure is stored verbatim, never re-rounded. A formula's intermediate multiplication is done in integer arithmetic on the parameters, with the single rounding at the end.

**The `pg` trap.** node-postgres returns `int8` as a **string** by default, on purpose, because int8 does not fit in a double. So a naive `row.spent_nano` is `"1300000"`, and there are two ways to get this wrong:

1. Someone writes `parseInt(row.spent_nano)`. Money is a float again, silently, and if the Kysely `Database` interface declares that column as `number` the type checker agrees with the mistake.
2. Someone "fixes" it globally with `pg.types.setTypeParser(20, Number)`. That converts _every_ int8 in the process to a double — including `ledger_entry.id` and every other `bigserial` — and it is a process-wide monkey patch that will never appear in the diff of a file a reviewer associates with money.

The decision: register a single parser for OID 20 returning `BigInt(value)`, at pool construction in `db/`, with a test that asserts a round-trip of `9223372036854775807`. The Kysely `Database` interface declares those columns `bigint`. The domain never sees a string, and never sees a `number`.

## Consequences

- The cap invariant is integer arithmetic executed by the database, so the check and the ledger cannot disagree by rounding (ADR 0007).
- The reconciliation `budget.spent_nano == SUM(ledger_entry.amount_nano)` is exact equality, which is why it can be a test assertion in the concurrency suite instead of a dashboard. With floats it would need an epsilon, and an epsilon in an accounting test is a test that never fails.
- Settlement from fal is a copy of `cost_estimate_nano_usd`, not a conversion.
- The cost confirmer can honestly show "US$ 0.0013 exact" next to "US$ 0.045 estimated", because the precision survives all the way to the screen and the `origin` travels with the number.

### What we give up

- Divergence from the house standard (integer cents) and from Herz (decimal string). No money code is portable between the projects, in either direction.
- `bigint` does not survive `JSON.stringify` — it throws `TypeError: Do not know how to serialize a BigInt`. Every boundary needs an explicit conversion: HTTP response, SSE event payload, log line, `jsonb` column, test snapshot. Forgetting one produces a 500 in a rare branch, which is exactly the branch nobody exercises. This is a permanent tax, and the only mitigation is that the branded type makes the conversion point visible.
- `bigint` and `number` do not mix in TypeScript arithmetic (`1n + 1` is a type error). That is protection in the domain and friction in every test fixture.
- Nine decimal places is more precision than any provider publishes. Those digits are false precision if a reader mistakes them for measured values; formatting must round for display, and nothing may round for storage.
- The `price` row cannot be a single scalar for formula-based providers. It is a discriminated union with numeric parameters — never an interpreted expression, never `eval` — and that is a more complex thing to write, review and seed than a number.

## Reconsider if

A price appears in the catalogue whose exact representation needs more than nine decimal places. The measurable form: any `price` row where the computed cost of one 1024×1024 image lands **below 1,000 nano (US$ 0.000001)**, so that the last three digits of the formula's result are being truncated. Per-output-token pricing is the likely source. The answer then is `numeric(38,18)` in Postgres with a decimal library in the domain, and paying the arithmetic cost that this ADR exists to avoid.

Reconsider the wire format separately if `bigint` serialization defects reach a released version **twice**. At that point the branded string is not carrying its weight and the boundary needs a codec applied by the contract layer itself, not by each handler.
