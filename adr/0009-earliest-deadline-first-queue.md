# ADR 0009: The queue orders by output expiry, not by arrival

- Status: Accepted
- Date: 2026-08-24

## Context

A standard outbox is FIFO: `ORDER BY next_attempt_at, id`. It is the right default when the only cost of being late is being late.

Prumo's output is perishable, and each provider's output has a different shelf life. From `docs/PROVEDORES.md`, collected 2026-08-24 against each provider's own documentation:

| Provider                  | Output lifetime                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| **BFL / FLUX**            | **10 minutes.** "Generated images expire after 10 minutes" — the hardest constraint in the set          |
| KIE (legacy download URL) | 20 minutes                                                                                              |
| fal                       | Queue result retained ~1 h, and **~6 minutes** when the payload is ≥ 10 KB. An image payload is ≥ 10 KB |
| Replicate                 | 1 hour, and the whole prediction record — input, output, logs — is deleted with it                      |
| Novita                    | `image_url_ttl: 3600` (1 hour)                                                                          |
| Segmind (v2)              | 1 hour, then 404 on the request id                                                                      |
| Together                  | Not documented. Treat as short                                                                          |
| KIE (task result)         | ~24 hours                                                                                               |

Under FIFO, a queue holding a BFL job behind twenty other jobs loses a paid image, and **no error is produced anywhere**. Nothing failed. The worker eventually ran, fetched a URL, and got a 404 for something the user already paid for. Silent and expensive is the worst pair of properties a failure can have.

## Decision

The ready-queue index and the capture `ORDER BY` are:

```
(priority, coalesce(deadline_at, 'infinity'), available_at)
WHERE completed_at IS NULL AND dead_at IS NULL
```

Earliest deadline first; arrival is the last tiebreaker, not the first key.

- `deadline_at` is derived from `generation.output_expires_at`, which comes from the model's `output_ttl_seconds` in the catalogue — a **per-endpoint** column, not a global constant, because 10 minutes and 24 hours are both real values in the same queue.
- **`ingest` enters at `priority = 0`** (0 is maximum). Priority outranks deadline deliberately: nothing else in this system is racing a clock that deletes money. Nothing is "done" before the bytes are in Prumo's own storage.
- `payload` stays out of the index `INCLUDE`. A `jsonb` payload duplicated inside the index grows exactly when the queue grows, which is exactly when the index needs to stay small.
- For a provider with no documented TTL, the catalogue stores a **short assumed value** with `method = 'estimated'`, never NULL. NULL sorts to infinity and would put an unknown-TTL job last — the wrong default when the unknown is most likely to be short (Together is the live example).

## Consequences

- Under queue pressure, the jobs about to lose money run first, and the ones with a day of slack wait. That is the correct priority for a system where the queue's contents are already-paid work.
- Fairness between users is explicitly **not** the ordering criterion here. Per-user `provider_slot` rows are what prevent one user from monopolizing a provider, and they do it before the queue ordering is ever consulted.
- The EDF ordering plus the `ingest` priority is what makes BFL usable at all. Without it, BFL would have to be excluded from fan-out, which would remove one of the three providers with exact cost reporting.

### What we give up

- **Starvation becomes possible by construction.** A 24-hour-TTL KIE job can sit behind an unbroken stream of BFL jobs indefinitely. FIFO's single virtue is that it cannot starve anything, and this trades that away with no aging term in the ordering. Adding one (`deadline_at` biased by age) is the obvious first patch, and it is deliberately not in the initial design because an unmeasured fairness mechanism is another thing to get wrong.
- **Ordering now depends on catalogue data being correct.** A wrong `output_ttl_seconds` — or a provider quietly changing theirs — misorders the queue, and the symptom appears as a lost image at a _different_ provider. The failure points at the wrong place, which is the most expensive kind of wrong.
- Incident diagnosis is harder. "Why has my job not run yet" now requires reading `task` and the model catalogue together, instead of counting rows ahead of it.
- Predictable completion order for the user is gone. Two identical requests can finish in a different order depending on which provider each routed to, and the UI has to show real queue position rather than an ordering the user could have predicted.

## Reconsider if

- **Starvation is measured:** over 1,000 queued tasks in a 7-day window, the maximum wait of the longest-TTL task exceeds **5× the median wait** across all tasks. The answer is an aging term or a reserved share of capture attempts for the oldest task — not a return to FIFO.
- **EDF is measured to be pointless:** p95 queue depth stays **below 2** over a 30-day window, meaning tasks are effectively never waiting behind each other. Then the ordering never changed an outcome, and FIFO with an `ingest` priority is the simpler thing that does the same job.
- **A provider changes its TTL under us:** if any recorded `output_ttl_seconds` is found stale by more than 2× on re-verification, the catalogue's TTL column needs the same `source` / `collected_at` / `method` treatment the price rows already have, and the same automatic expiry from use.
