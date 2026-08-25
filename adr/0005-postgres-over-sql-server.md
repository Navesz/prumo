# ADR 0005: PostgreSQL 17, not SQL Server, and no SQLite path

- Status: Accepted
- Date: 2026-08-24

## Context

The house stack is SQL Server with `tedious`, inherited from Herz. That inheritance needs a correction that is documented in `PLANO.md` §2: **Herz's backend does not exist.** Checked on disk — no `package.json` declares Fastify, Kysely or tedious; there is no `apps/api`; there is not one migration. What exists is `apps/web`, `packages/contracts` and `packages/dominio`, with the frontend talking to a fake transport. So this is not a migration away from a running system. It is the choice of the first one, and what Herz contributes is reasoning, not operational experience.

Five premises of the Prumo design are Postgres features rather than preferences:

- **`FOR UPDATE SKIP LOCKED`** for the task queue and, more importantly, for `provider_slot`. The naive concurrency limit — count in-flight generations, compare to the limit — is racy: two workers read `n=1 < 2` in the same instant, both capture, three requests go out, fal returns 429 `concurrent_requests_limit`. With a slot row, `SKIP LOCKED` over that row _is_ the count, and the race stops existing.
- **`LISTEN`/`NOTIFY` → SSE**, one connection per tab, no Redis and no polling loop in the common path.
- **Row-level security** as the second door behind `user_id` in every repository `WHERE`. The isolation test at M1 (user A reaches nothing of user B) has two independent things to pass through.
- **`jsonb`** for `price.formula` (a discriminated union with numeric parameters), for `price_snapshot` stored by value, and for sanitized `error_detail`.
- **Partial indexes**, which the schema uses seven times and which carry the hot paths: the in-flight index `WHERE state IN ('dispatching','generating','ingesting')`, the ready-queue index `WHERE completed_at IS NULL AND dead_at IS NULL`, the free-slot index `WHERE task_id IS NULL`, the gallery keyset `WHERE deleted_at IS NULL`, the blob GC queue `WHERE refs = 0`, the reconciliation queue `WHERE state = 'doubt'`, and the public-visibility index.

On top of that: SQL Server is licensed, and in practice ties self-hosting to Windows. The distribution model is `docker compose up` on a stranger's Linux box, and an Apache-2.0 project cannot require its self-hosters to accept a proprietary EULA to run it.

## Decision

PostgreSQL 17. `pgcrypto` only for `gen_random_uuid`; `citext` for e-mail. Kysely 0.28 + `pg` 8.13 — one pool, one transaction API, one `UnitOfWork` as the only place a transaction opens. Migrations run at boot under an advisory lock. Two compose services: `prumo` and `postgres:17-alpine`, two volumes.

**There is no SQLite path.** Not "later", not "for tests", not "for the single-user mode". SQLite has no row-level locking to skip (it has a database-level write lock), no `LISTEN`/`NOTIFY`, no RLS, no `jsonb` operators, and no partial indexes over the expressions used here. A SQLite mode would be a second implementation of the concurrency design, and the concurrency design is the product.

## Consequences

The switch erases an open risk inherited from Herz, and this is worth recording because it is the one place where diverging from the house stack removes work instead of adding it.

Herz's outbox capture is a CTE with `WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)` (`guias/banco.md:153`), and it is the single query in that project marked as a hypothesis until tested with two concurrent pollers (`guias/banco.md:184-186`). It carries a subtlety that has to be right or the whole thing silently degrades: under RCSI the row-search phase of an `UPDATE` reads by versioning, so `READPAST` has no lock to skip and becomes a no-op — the contention reappears at revalidation, with no error and no log. `READCOMMITTEDLOCK` is what restores locking semantics to that read. `FOR UPDATE SKIP LOCKED` has none of that surface: it is one clause, it is the documented mechanism, and its failure mode is a query that blocks, not a query that quietly stops skipping.

The reasoning survives whole — correctness under concurrency, not scale. The untested query does not survive, and does not need to.

Other consequences: `docker compose up` works on Linux, macOS and Windows with the same two images; the self-hoster pays nothing for a license; the queue, the slots, the ledger and the real-time channel all live in one system with one transaction boundary.

### What we give up

- The owner's operational familiarity. The SQL Server knowledge accumulated in Herz's guides — isolation levels, what `rowversion` protects and what it does not, reading a deadlock graph — does not transfer line for line, and the first production incident will be debugged in the less familiar system.
- `rowversion` as an optimistic-concurrency primitive. Postgres has `xmin`, which this project deliberately does not use; `generation.version` is an explicit integer column instead, which means every writer must remember to bump it — a discipline the database used to provide for free.
- Any integration with T-SQL tooling the owner already operates elsewhere.
- The zero-service local development story SQLite would have offered. Running any test that touches the database now requires Docker, and that is a genuine barrier for a drive-by contributor fixing a price row on a laptop without it. The intended answer is that catalogue and formula tests are pure functions with no database at all — but that is a claim about code not yet written.

## Reconsider if

- **The no-SQLite half:** if 3 recorded onboarding attempts by real people show a contributor cannot reach a green `npm run verificar` within 10 minutes on a clean machine, with the reason logged in an issue. The expected answer is still not SQLite — it is testcontainers or a shared throwaway Postgres — but that measurement is what forces the question onto the table instead of leaving it as an assumption about strangers.
- **The RLS premise:** if the query plan for the gallery keyset shows RLS predicates adding more than **20% to p95** at 100k rows in a single user's gallery, measured with `EXPLAIN (ANALYZE, BUFFERS)` on real data. Then RLS becomes a test-only guard and `user_id` in the repository `WHERE` stands alone — losing the second door, and saying so.
- **The engine itself:** only if a target deployment platform the project decides to support offers no Postgres at all. Cost is not a trigger; Postgres is free in every relevant sense here.
