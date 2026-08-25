# Architecture decision records

Decisions that are expensive to reverse, with the reasoning that produced them and the measurement that would overturn them.

Every record here predates the product. Prumo is at M0/M1 — the verification gate and the empty vertical skeleton — and **no product feature exists yet**. Nothing in this directory describes running software. Where a record states a number that was measured, it names the measurement; where it states a number that was assumed, it says so.

## Index

| #                                                     | Title                                                                         | Status   | Date       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-english-as-repository-language.md)        | English as the repository language                                            | Accepted | 2026-08-24 |
| [0002](0002-vendor-alicerce-tooling.md)               | Vendor the Alicerce tooling instead of depending on it                        | Accepted | 2026-08-24 |
| [0003](0003-money-as-integer-nano-usd.md)             | Money as integer nano-USD                                                     | Accepted | 2026-08-24 |
| [0004](0004-server-side-key-vault.md)                 | The key vault lives on the server                                             | Accepted | 2026-08-24 |
| [0005](0005-postgres-over-sql-server.md)              | PostgreSQL 17, not SQL Server, and no SQLite path                             | Accepted | 2026-08-24 |
| [0006](0006-single-process-topology.md)               | One process serving HTTP, worker and SSE                                      | Accepted | 2026-08-24 |
| [0007](0007-budget-invariant-in-the-where-clause.md)  | The spending cap lives in the WHERE clause, and the composite CHECK is banned | Accepted | 2026-08-24 |
| [0008](0008-task-lease-per-type.md)                   | Lease per task type — revoking the 60-second rule                             | Accepted | 2026-08-24 |
| [0009](0009-earliest-deadline-first-queue.md)         | The queue orders by output expiry, not by arrival                             | Accepted | 2026-08-24 |
| [0010](0010-assumed-scale-and-retention.md)           | Assumed scale, and the gallery keeps the bytes forever                        | Accepted | 2026-08-24 |
| [0011](0011-orpc-instead-of-ts-rest.md)               | oRPC instead of ts-rest                                                       | Accepted | 2026-08-24 |
| [0012](0012-day-cap-not-session-cap.md)               | A day cap, not a session cap                                                  | Accepted | 2026-08-24 |
| [0013](0013-application-runs-as-a-restricted-role.md) | The application runs as a role that cannot bypass RLS                         | Accepted | 2026-08-25 |

## Format

Every record has these sections, in this order:

1. **Title** — the decision, not the topic. "Money as integer nano-USD", not "Money handling".
2. **Status** and **Date** — `Accepted`, `Superseded by NNNN`, or `Deprecated`.
3. **Context** — the forces, with sources. A claim with a number carries where the number came from and when it was collected; a claim without a source says it was not verified.
4. **Decision** — what is now true, in the imperative.
5. **Consequences**, including a **What we give up** subsection that is written honestly. A record whose consequences are all positive is a record that was not thought through.
6. **Reconsider if** — a concrete, **measurable** trigger. Not "if it becomes a problem". A threshold, a window, and how it is measured.

A record with no measurable trigger in "Reconsider if" is not finished. The trigger exists so that the first real measurement has something to compare against, instead of a feeling; and so that reversing a decision is a normal event with a defined cause rather than an argument.

## Rules

- **Accepted records are not edited.** A decision that changes gets a new record that supersedes the old one, and the old one gains a `Superseded by NNNN` line. The reasoning that was wrong is part of the history and is the most useful thing in the directory.
- Numbering is sequential and permanent. A withdrawn record keeps its number.
- Records are in **English** (ADR 0001). `PLANO.md`, `docs/ESQUEMA.md`, `docs/PROVEDORES.md`, `README.pt-BR.md`, `.ai/` and the vendored `ferramental/` tree are the closed list of exceptions.

## When a change needs a record

Open one before merging a change that affects: the public HTTP contract, the money representation or the ledger, the database engine or a schema invariant, credential handling, the runtime topology, the queue's ordering or lease semantics, retention and storage policy, licensing, or the supported deployment modes.

## State marks used across the project

- ✅ proven — measured or demonstrated in this repository
- 🧪 decided but not measured
- 🔴 blocks code — an open question that stops work until it is answered

Treating 🧪 as ✅ is the mistake the marks exist to prevent. This architecture is 🧪 nearly everywhere: the project it inherits its reasoning from has no backend at all.
