# ADR 0007: The spending cap lives in the WHERE clause, and the composite CHECK is banned

- Status: Accepted
- Date: 2026-08-24

## Context

Fan-out means eight models dispatched from one click, inside one transaction, in the same millisecond. The spending cap has to hold there, and "read the budget, decide, then write" does not: between the `SELECT` and the `UPDATE` there is a window, and the window is where eight concurrent reservations each see enough room for themselves.

This is the same shape as Herz's `reservarEstoque` (`guias/banco.md:78-101`), with the difference that here the resource being reserved is the user's money at a third party, and an overshoot is not a stock discrepancy to reconcile — it is a charge on their card.

## Decision

**The rule's condition is the write's condition.**

```sql
UPDATE budget
   SET reserved_nano = reserved_nano + $cost
 WHERE user_id = $u AND window = $w AND window_start = $s
   AND spent_nano + reserved_nano + $cost <= cap_nano
RETURNING cap_nano - spent_nano - reserved_nano AS remaining;
```

**Zero rows affected means the cap was hit.** There is no gap between checking and debiting, and therefore no arrangement of concurrent requests that can cross the cap. The API answers 422 with `available_nano`, and the UI offers to generate only the N cheapest routes.

Supporting rules, all of which are part of the same invariant:

- **Fixed write order: always `month`, then `session`.** Two transactions touching the same two rows in different orders is the recipe for a predictable deadlock.
- Reservation and settlement are separate ledger entries — `reserve`, `settle`, `refund`, `adjust` — and `unique(generation_id, type)` is what makes the at-least-once worker unable to charge twice.
- Both cap policies are race-free because each reservation is its own atomic conditional `UPDATE`: `all_or_nothing` returns 422 with the available amount, and `as_far_as_it_fits` reserves route by route in ascending cost and stops at the first zero-row result.
- Money is integer nano-USD (ADR 0003), so the comparison in that `WHERE` is exact integer arithmetic evaluated by Postgres, not a float comparison and not a string.

### `CHECK (spent_nano + reserved_nano <= cap_nano)` is banned

It looks like the constraint that makes the invariant airtight. It is the constraint that breaks the system, and it breaks it in the branch nobody tests.

At settlement, the actual cost can exceed the reservation, and **the money is already gone at the provider**. A Runware response whose `cost` came back above the estimate. A fal `billing_event` that settles above the pre-flight `cost_estimate_nano_usd`. A Replicate generation whose cost is an estimate forever, because there is no billing API to reconcile against. In each case the charge happened, the image exists, the invoice will show it.

Refusing that write does not un-spend the money. It produces a ledger that reports a smaller number than the user's real invoice — and it fails at the last step of a successful generation, after the image is in storage, in an error path that only runs when an estimate was wrong.

What survives is `CHECK (>= 0)` on each column, which forbids a state that is nonsense rather than a state that is unwelcome. An overrun stamps `exceeded_at` and becomes a warning banner in the UI.

> **General rule: a CHECK that prevents recording a fact that already happened does not protect the invariant. It destroys the audit trail.**
>
> The invariant belongs where the decision is made — before spending. After spending, the only correct action is to record what happened and make the discrepancy visible.

## Consequences

- It is structurally impossible for concurrent fan-out to break the cap, rather than unlikely under testing.
- The reconciliation `budget.spent_nano == SUM(ledger_entry.amount_nano)` must return zero rows always, and it is an assertion inside the concurrency test suite, not a dashboard. A gate, not a report someone may forget to open.
- The ledger stays append-only — no `UPDATE`, no `DELETE`, revoked in the `GRANT` — so the discrepancy between reservation and settlement is two visible rows rather than one edited number.
- M3's acceptance proof is exactly this: two batches racing for the last cent, one wins.

### What we give up

- **The database no longer guarantees `spent + reserved <= cap` at rest.** A row can sit above its cap after a settlement overrun and nothing stops it. Anyone reading the schema alone will call this a missing constraint and be wrong; the table needs a comment pointing here, and the reconciliation test is the only executable statement of intent.
- Correctness now depends on every write path using the conditional `UPDATE`. A future `UPDATE budget SET reserved_nano = ...` written without the predicate reopens the hole silently, and no constraint catches it — which is the thing a constraint is for. `dependency-cruiser` cannot express this. The mitigations are that reservation exists in exactly one repository function and that the planted race test at M3 would fail; both are weaker than a constraint, and that is the trade.
- Failure arrives as "zero rows affected", which is indistinguishable from "row not found" unless the caller works to tell them apart. The repository must re-select on zero rows to classify, or a user with a missing budget row is told they are over their cap.
- A cap overrun is only ever visible after the fact. A user can finish a month above the cap they set, by the accumulated size of the settlement discrepancies.

## Reconsider if

- **More than 2% of settled generations in any 30-day window have `actual_cost_nano > reserved_nano`.** Then the estimator is wrong, not the constraint model, and the fix is the pricing formula or a reservation multiplier — not a CHECK.
- **Any single overrun exceeds 1% of the cap**, or the accumulated monthly overrun exceeds 1% of the cap. At that point the software-side cap is not enough by itself and the product must require a per-key spend limit set in the provider's own console — which is 🔴 unverified across the thirteen providers and needs to be checked before it can be required.
- If a future provider offers a hold-and-capture payment primitive (reserve an exact amount, capture at most that), the reservation could become authoritative and the overrun case would disappear. None of the thirteen offers one today.
