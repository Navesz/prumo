# ADR 0008: Lease per task type — revoking the 60-second rule

- Status: Accepted
- Date: 2026-08-24

## Context

Herz's outbox carries a rule, stated as an absolute:

> "Nenhum job da outbox passa de 60 s. Quem não garante isso não roda na outbox." (`guias/banco.md:189`)
> _No outbox job takes longer than 60 s. If you can't guarantee that, you don't run on the outbox._

It is a good rule there, and the reasoning is explicit: the alternative is a worker renewing `locked_until`, which requires a heartbeat and more machinery than that project's remaining consumers justify.

**The premise is true there and false here.** Image generation exceeds 60 seconds routinely, and the evidence is in the provider research:

- Replicate cold boot on a rarely used community model takes minutes, and `metrics.predict_time` does not include that wait — so the number the provider reports is not the number the lease has to cover.
- Replicate's `Prefer: wait` is capped at 60 s and can still return `starting`.
- Google's image models have thinking enabled by default and not disableable, with irregular latency.
- fal, KIE, BFL, Novita and Segmind are queue-based: the dispatch returns immediately, but the generation the task is responsible for does not.

With a 60-second lease, the lease expires while the call is still in flight. A second consumer captures the same task and **fires the same paid call**. The user pays twice for one prompt. Nothing reports an error, because nothing failed.

## Decision

The 60-second rule is revoked for Prumo, in writing, so that nobody reintroduces it from the house guides. The lease is per task type, stored on the row (`task.lease_seconds`, `lease_until`, `lease_by`):

| Type       | Lease | Why that number                                                                                                                                                |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatch` | 30 s  | One POST. If it has not returned in 30 s the read timed out and the outcome is unknown — which is `payment_doubt`, not a retry                                 |
| `poll`     | 30 s  | A poll reschedules itself with backoff 2 → 5 → 10 → 20 s, never below 2 s (WaveSpeed's explicit recommendation). Each individual poll is short by construction |
| `ingest`   | 120 s | Stream download, SHA-256 on the way through, upload to storage, three variants plus thumbhash, then ledger settlement — for a payload that can exceed 10 MB    |

Supporting rules:

- **`state` never holds "processing".** In flight is `lease_until > now()`. Two sources of truth produce orphan rows the moment a process dies mid-write.
- Every consumer is idempotent by `dedup_key`, and `unique(generation_id, type)` on the ledger makes a double settlement impossible even if a task does run twice.
- **Retry is forbidden — not discouraged — when a read timeout meets a model whose `supports_idempotency` is false.** That path writes `payment_doubt` and stops. WaveSpeed states the reason in their own documentation: a disconnected response can still correspond to a prediction that was accepted and billed. Calling that an error and letting the user click again is turning a bug into a double charge.

## Consequences

- The lease is sized to the work, so lease expiry means what a lease is supposed to mean: the worker died. It no longer also means "the provider was slow".
- `dispatch` keeps a short lease, so a hung POST is detected quickly and classified as doubt rather than retried into a second charge.
- The three numbers are data on the row, not constants in code, so a provider-specific adjustment is a value, not a deploy.

### What we give up

- **Crash recovery is now up to 120 s for ingestion.** A worker killed mid-ingest leaves the generation invisible while the row is still leased. Against BFL's 10-minute output TTL, that is 20% of the window spent waiting for a lease to expire — and the ingest task is the one that is racing that clock (ADR 0009).
- Three numbers to tune instead of one rule to obey. Every one of them is a guess: none has been measured. 🧪
- No heartbeat means we cannot distinguish "slow" from "dead" inside the lease window. That is the machinery Herz refused, and it is refused here for the same reason — one operator, and every renewal path is a new way to hold a lease forever.
- The 60-second rule was portable across projects and needed no explanation. The per-type table is Prumo-specific knowledge, and a contributor has to read this ADR to know why `ingest` is allowed four times what `dispatch` is.

## Reconsider if

- **p99 of any task type exceeds 60% of its lease** over 1,000 executions. Concretely: p99 `ingest` above 72 s, or p99 `dispatch` above 18 s. At that point the lease is too tight and the next duplicate paid call is one slow provider away. The answer for `ingest` is to raise the lease or to split it into `download` and `post_process`; the answer for `dispatch` is a shorter HTTP read timeout, so the timeout classifies before the lease expires.
- **Fewer than 1 in 10,000 leases expire without the task completing.** Then the leases are longer than crash recovery needs, and the recovery latency is being paid for nothing.
- If a heartbeat ever becomes cheap — for example, if the worker already writes progress rows for the UI at a fixed interval — renewing the lease on the same write is nearly free, and the fixed table becomes unnecessary. Trigger: progress updates land at ≥ 1 per 10 s per in-flight generation for other reasons.
