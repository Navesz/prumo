# 0013 — The application runs as a role that cannot bypass RLS

**Status:** Accepted, 2026-08-25.

## Context

Migration 0001 enabled row level security on every user-owned table and added
`FORCE ROW LEVEL SECURITY`, which closes the table-owner hole: without it, the role
that owns a table ignores its own policies, and in the default compose the
application connects **as** the owner.

That was not enough, and the isolation test said so on the first CI run: one user
read another user's rows.

PostgreSQL documents the remaining hole plainly — a **superuser**, and any role with
**BYPASSRLS**, always bypasses row security. `FORCE ROW LEVEL SECURITY` does not
change that.

And the default deployment walks straight into it. `POSTGRES_USER: prumo` in
`docker-compose.yml` makes `prumo` the cluster superuser. Anyone following the README
would have run an instance where every policy in the database was decoration — with
other people's paid API keys inside it.

## Decision

Migration 0002 creates `prumo_app`: `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`,
`NOCREATEDB`, `NOCREATEROLE`. It gets `SELECT, INSERT, UPDATE, DELETE` on tables and
`USAGE, SELECT` on sequences, plus `ALTER DEFAULT PRIVILEGES` so tables added by later
migrations inherit the same grants. It gets **no DDL**.

Every runtime connection runs `SET ROLE prumo_app` in the pool's `connect` handler, so
`current_user` is restricted before any application query executes. A connection whose
`SET ROLE` fails is **destroyed**, never returned to the pool: a connection that could
not drop its privileges is a connection still holding them.

Migrations keep running as the owner, on a separate short-lived pool that is closed
before the application pool is created. The split between the two pools is a security
boundary, not tidiness.

`database.test.ts` asserts `current_user`, `rolsuper` and `rolbypassrls` directly. That
is the assertion that would have caught this immediately, instead of through a failing
isolation check three commits later.

## Consequences

Row level security is now load-bearing rather than decorative, and the property is
pinned by a test that fails if anyone points the app at a superuser connection again.

### What we give up

- One more moving part in the boot path, and a role that lives at cluster level rather
  than inside the database — so dropping the database does not drop the role. Migration
  0002 tolerates a re-run for exactly that reason.
- A self-hoster who points `DATABASE_URL` at a managed Postgres where they cannot
  `CREATE ROLE` will fail at migration 0002. That is the correct failure: the
  alternative is running with the isolation switched off and not knowing.

## Reconsider if

A deployment target makes `CREATE ROLE` impossible. The answer then is a documented
pre-provisioned role name read from configuration — **not** falling back to the owner.
