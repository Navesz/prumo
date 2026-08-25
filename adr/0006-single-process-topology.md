# ADR 0006: One process serving HTTP, worker and SSE

- Status: Accepted
- Date: 2026-08-24

## Context

The system has three runtime jobs: an HTTP API, a background worker (dispatch, poll, ingest, settle, reconcile, collect prices, rewrap), and an SSE fan-out driven by `LISTEN`/`NOTIFY`. The textbook answer is three deployables.

The counter-argument is written in Herz's own risk list, and it is the exact self-diagnosis of this project: _each item is defensible in isolation; added up, it is quite a lot to sustain alone_ (`Riscos.md:59-63`). One process means one log, one deploy, one place to attach a debugger at 3 a.m. For a project whose operator is one person, the operational surface is a first-class design constraint, not an afterthought.

Splitting also has a hidden cost that is easy to forget: it turns an in-memory rate limiter into a defect. Herz's first auth defect is a per-process `Map` for rate limiting — which is only a defect because there are N processes. With one process, the simple implementation is correct again.

## Decision

One Node binary. Role selected by **`PRUMO_PAPEL=api|worker|tudo`** — the name as it appears in `PLANO.md`; ADR 0001 renames it to `PRUMO_ROLE=api|worker|all` when the boot code is written, with the same three values. Default is everything. Two compose services (`prumo`, `postgres`), Caddy as an optional profile, three commands to bring the system up.

**The code is born separable even though the deploy is single.** `dependency-cruiser` enforces the layers — `domain/`, `app/`, `http/`, `db/`, `providers/`, `storage/`, `vault/` — with rules that matter operationally, not aesthetically: `providers/` may not import `db/` or `domain/`; `domain/` and `app/` may not import an HTTP client, S3, or `fs`. That last rule is what mechanically enforces "no external I/O inside a transaction", which in this system is worth money: transaction opens → call fal → deadlock → transaction retries → **call fal again** → two images, two charges. An external effect has no rollback. Every rule ships with a planted violation proving it fails, because Herz's `dominio-puro` rule spent months reporting "no dependency violations found" with React inside the domain.

The worker loop runs in the same process, but image work does not run on the event loop: `sharp` executes inside a `piscina` pool over `worker_threads`, with `sharp.cache(false)`. Variant generation on the main thread is precisely how one process becomes a stalled API.

Shutdown is a drain: stop capturing tasks, wait up to 30 s for in-flight leases, exit.

When measurement demands two processes, it is a compose line — one service with `PRUMO_PAPEL=api`, one with `worker` — not a refactor. That is the whole reason for the boundaries.

## Consequences

- Three commands from clone to running system, which is the self-hosting promise.
- One stack trace, one log stream, one process to restart.
- In-memory rate limiting is correct, and correct with the obvious implementation.
- The writer and the SSE publisher share a transaction boundary, so an event is never published before its `COMMIT`.

### What we give up

- **A single point of failure, deliberately.** A deploy takes HTTP, worker and SSE down together. A memory leak in ingestion evicts the API with it — and ingestion is where the large allocations live: OpenAI returns images only as inline base64, and a 4K image can exceed 10 MB per response, in a fan-out of six. The real mitigation for this is redundancy, which is the architecture being refused. Drain mode plus off-hours deploys is a smaller answer, and it is labelled as smaller rather than sold as equivalent.
- Independent scaling. A burst of ingestion cannot be answered by adding workers only; it is answered by adding whole instances, which reintroduces the multi-process rate-limit defect the single process fixed.
- CPU isolation. `piscina` is mitigation, not separation: an unbounded pool queue still starves the event loop, and the pool size is one more number nobody has measured.
- The blast radius of a worker crash now includes logged-in user sessions and every open SSE stream.

## Reconsider if

Any one of these, **measured**, not felt:

1. **p95 of the task-capture step exceeds 50 ms** over a rolling 24 h window containing at least 1,000 captures. The capture step is the transaction that takes a `provider_slot` row and a `task` row with `FOR UPDATE SKIP LOCKED`. Below 50 ms, contention is not the problem and splitting solves nothing.
2. **p95 API latency degrades by more than 2×** between an idle window and a window with ≥ 4 generations in flight, over the same route set, same day, excluding SSE connections. That is the worker stealing the event loop, which is the failure this topology is exposed to.
3. **Process RSS exceeds the container limit more than once in 30 days**, with ingestion identified as the allocator in the heap snapshot.

None of these numbers has been measured. The architecture is 🧪 — decided, not measured; Herz, which it inherits its reasoning from, has no backend at all. The point of writing thresholds now is that the first measurement has something to be compared against instead of a feeling, and that "it feels slow" is not sufficient to spend the deploy simplicity this ADR is buying.
