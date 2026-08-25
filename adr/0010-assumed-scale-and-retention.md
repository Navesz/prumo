# ADR 0010: Assumed scale, and the gallery keeps the bytes forever

- Status: Accepted
- Date: 2026-08-24

## Context

`PLANO.md` §14 lists four 🔴 blockers — questions that stop code from being written. Two of them are answered here, by the owner, on 2026-08-24:

> 2. Does the gallery keep bytes forever or expire them? Retention decided later becomes a migration over large data — and it is the cost policy.
> 3. Expected volume, in order of magnitude. If it is three images a day for one person — the most likely scenario for the first six months — then slots, EDF and backpressure are answers to a problem that does not exist.

They are answered as **assumptions, not measurements**. Nothing in this repository has ever served a request; M0/M1 are under construction and no product feature exists yet. An assumption written down with a falsification threshold is worth something. An assumption that leaks into the design unlabelled is worth less than nothing, because the next reader will treat it as a fact.

## Decision

### (a) Assumed scale

Volume is not known. The working assumption is **5 to 20 users and a few hundred generations per day** for the first six months.

Every capacity decision is sized for that and nothing more: one process (ADR 0006), one Postgres, disk storage by default with S3 as a driver rather than a dependency, no Redis, no CDN, no read replica, no queue broker.

The part that has to be said plainly: **at a few hundred generations a day, provider slots, EDF ordering and backpressure are answers to a problem nobody has observed here.** They stay in the design anyway, for a reason that is not performance. A race that double-charges a user is not a throughput problem, it is a money problem, and it appears at _two_ concurrent requests, not at two hundred. Fan-out from one click is eight concurrent requests on day one, with a new fal account whose concurrency limit is 2. Slots and EDF are correctness mechanisms that happen to look like scale mechanisms, sized for a small system.

Backpressure that is genuinely about volume — batching, sharding, caching layers — is **not** in the design, and that is the line this assumption draws.

The numbers that would falsify the assumption: sustained **more than 2,000 generations/day for 14 consecutive days**, or **more than 100 distinct users active in a 30-day window**.

### (b) Retention: the gallery keeps the bytes forever

`image.purge_at` (`expurgo_em` in `docs/ESQUEMA.md`) is created in the **first** migration and stays NULL. Nothing writes it. No job reads it. It exists from day one because retention decided later is a migration over large data, and because a column is the natural place a future policy attaches — adding it later means backfilling across every stored image at the exact moment storage is already the problem.

An image leaves only by the user's action. Deleting decrements `blob.refs`; only the last reference removes the object from storage. Deduplication is scoped per user on purpose, so one user's deletion can never affect another's bytes.

## Consequences

**The disk bill grows every month, forever. There is no steady state.**

An order-of-magnitude sketch, with the assumed volume: 300 generations/day × ~1.5 MB stored per generation (original plus three variants plus a 28-byte thumbhash) ≈ 450 MB/day ≈ **13.5 GB/month ≈ 160 GB/year**, growing by that much again every year. The per-generation size is an estimate, not a measurement — nothing has been stored yet, and image size varies by resolution and format across thirteen providers. The first month with real data replaces these numbers, and until then they are labelled 🧪.

The upside is real and is the reason for the decision: the gallery is a permanent archive, which is what makes side-by-side comparison across months worth anything, and a user's record of what a model used to produce does not silently disappear.

The obligation that comes with it: `README.md` must say this before a stranger runs `docker compose up` on a 20 GB VPS. A self-hoster inherits an unbounded volume, and finding that out at 100% disk — with Postgres refusing writes — is finding out the worst way.

### What we give up

- Any bound on storage cost. Deletion is entirely the user's initiative, and users do not delete.
- The ability to quote a self-hoster a disk budget, or to answer "how much will this cost me to run" with anything but "it depends on how much you generate, forever".
- A cheap answer to a deletion request at scale. Nothing expires, so every byte belonging to a person has to be found and removed through an explicit cascade that has not been written.
- Confidence in every capacity decision downstream of assumption (a). If volume is wrong by 10×, the single process is not the first thing that breaks — the disk is, and it breaks in a way that takes the database with it.

## Reconsider if

Each of these is measurable, and any one of them reopens the decision:

- **Stored bytes for a single user pass 50 GB**, or **total stored bytes pass 500 GB** on the official instance. The first candidate answer is tiering — originals to cold storage after 180 days, variants kept hot — not deletion, and not a retroactive purge of what users were told would be kept.
- **The monthly storage line of the hosting bill exceeds US$ 20.** At object-storage prices in the US$ 0.015/GB-month range that is roughly a terabyte; the price is an order of magnitude, not a quote, and `PLANO.md` §14 already flags its own infrastructure figures (~R$ 30/month idle) as unverified.
- **Assumption (a) is falsified** by either threshold above (> 2,000 generations/day for 14 days, or > 100 active users in 30 days). Scale and retention fail together, because the same number drives both.

Whatever replaces this decision must be opt-in per user or announced far in advance. A retention policy applied retroactively to images a user was told would be kept forever is a data loss event with a changelog entry, not a policy change.
