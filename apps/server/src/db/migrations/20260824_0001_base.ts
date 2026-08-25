import { sql, type Kysely } from 'kysely'

/**
 * The first migration.
 *
 * It carries only what M1 needs to prove the skeleton holds: an account, a
 * session, a spending budget and the idempotency table. Generations, providers,
 * models, prices, tasks, slots, blobs and the ledger arrive with the milestone
 * that uses them — a table nobody writes to yet is a guess, not a schema.
 *
 * Two decisions are load-bearing and are made here, not later:
 *
 *   1. RLS is FORCED, including for the table owner. Without FORCE, the owner
 *      bypasses every policy, and in the default compose the app connects AS the
 *      owner — the isolation would have been decoration from day one.
 *
 *   2. Money is bigint nano-USD with `CHECK (>= 0)` only. There is deliberately
 *      no `CHECK (spent + reserved <= cap)`: at settlement the metered cost can
 *      exceed the reservation and the money is ALREADY SPENT at the provider.
 *      A CHECK that refuses to record a fact that already happened does not
 *      protect the invariant, it destroys the audit trail. The invariant lives in
 *      the WHERE clause of the reservation.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(db)

  // --- users ------------------------------------------------------------------

  await sql`
    CREATE TABLE users (
      id            uuid PRIMARY KEY,
      email         citext NOT NULL,
      password_hash text,
      name          text,
      role          text NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
      active        boolean NOT NULL DEFAULT true,
      -- Not decoration: this is what decides where the month of a spending cap
      -- begins. Comparing a local day against UTC midnight is how you hand
      -- somebody a cap that resets on the wrong day.
      timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE UNIQUE INDEX users_email_key ON users (email)`.execute(db)

  // --- sessions ---------------------------------------------------------------
  //
  // Opaque tokens in a table, not JWT. The argument that settles it: a JWT exists
  // to avoid hitting the database, and we hit the database on every request
  // anyway — for the cap, the credential and the role. So the JWT would buy
  // nothing and cost revocation.

  await sql`
    CREATE TABLE sessions (
      id           uuid PRIMARY KEY,
      user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- The token itself is NEVER stored. A SELECT on this table must not be
      -- enough to impersonate anyone.
      token_hash   bytea NOT NULL,
      expires_at   timestamptz NOT NULL,
      last_used_at timestamptz,
      ip_hash      bytea,
      ua_hash      bytea,
      created_at   timestamptz NOT NULL DEFAULT now(),
      revoked_at   timestamptz
    )
  `.execute(db)

  await sql`CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash)`.execute(db)
  await sql`CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL`.execute(
    db,
  )
  await sql`CREATE INDEX sessions_expiry_idx ON sessions (expires_at)`.execute(db)

  // --- budgets ----------------------------------------------------------------

  await sql`
    CREATE TABLE budgets (
      id             uuid PRIMARY KEY,
      user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      window         text NOT NULL CHECK (window IN ('month', 'day')),
      window_start   timestamptz NOT NULL,
      window_end     timestamptz NOT NULL,
      cap_nano       bigint NOT NULL CHECK (cap_nano >= 0),
      reserved_nano  bigint NOT NULL DEFAULT 0 CHECK (reserved_nano >= 0),
      spent_nano     bigint NOT NULL DEFAULT 0 CHECK (spent_nano >= 0),
      -- Stamped when settlement crossed the cap. The write is ALLOWED: the money
      -- was already spent at the provider, and refusing it here would produce a
      -- ledger that lies about the real invoice.
      exceeded_at    timestamptz,
      alert_percent  smallint NOT NULL DEFAULT 80 CHECK (alert_percent BETWEEN 1 AND 100),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE UNIQUE INDEX budgets_window_key ON budgets (user_id, window, window_start)
  `.execute(db)

  // --- idempotency ------------------------------------------------------------
  //
  // Turns "unknown result" into a safe retry. Written INSIDE the same transaction
  // as the effect, and ONLY on success: caching a refusal is the Herz B5 bug,
  // where a 422 got stored against the commandId and locked the user out of ever
  // resending the same request.

  await sql`
    CREATE TABLE processed_commands (
      command_id uuid PRIMARY KEY,
      user_id    uuid REFERENCES users (id) ON DELETE CASCADE,
      route      text NOT NULL,
      status     smallint NOT NULL CHECK (status BETWEEN 200 AND 299),
      result     jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE INDEX processed_commands_created_idx ON processed_commands (created_at)`.execute(
    db,
  )

  // --- row level security -----------------------------------------------------
  //
  // Second door. The first door is the WHERE clause of every repository: filtering
  // by owner in the query, never checking ownership after the fact. RLS exists so
  // that a repository written wrong is caught by the database instead of leaking.

  for (const table of ['users', 'sessions', 'budgets', 'processed_commands']) {
    await sql`ALTER TABLE ${sql.ref(table)} ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE ${sql.ref(table)} FORCE ROW LEVEL SECURITY`.execute(db)
  }

  // `app.user_id` is set with SET LOCAL inside the UnitOfWork, so it lives for
  // exactly one transaction. The `true` argument makes current_setting return
  // NULL instead of raising when it was never set, which is what makes the
  // unauthenticated path (registration, sign-in) work.
  await sql`
    CREATE POLICY users_self ON users
      USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid)
  `.execute(db)

  for (const table of ['sessions', 'budgets', 'processed_commands']) {
    await sql`
      CREATE POLICY ${sql.ref(`${table}_own`)} ON ${sql.ref(table)}
        USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    `.execute(db)
  }

  // Registration and sign-in run before a session exists, so they cannot go
  // through the policy above. They use a role-free escape hatch: a SECURITY
  // DEFINER function would hide too much, so instead the UnitOfWork opens those
  // two paths with `app.bypass_rls` set, and the policy below is what honours it.
  // Only two use cases may set it, and a boundary rule proves no third one does.
  await sql`
    CREATE POLICY users_bootstrap ON users
      USING (current_setting('app.bypass_rls', true) = 'on')
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on')
  `.execute(db)

  await sql`
    CREATE POLICY sessions_bootstrap ON sessions
      USING (current_setting('app.bypass_rls', true) = 'on')
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on')
  `.execute(db)

  await sql`
    CREATE POLICY budgets_bootstrap ON budgets
      USING (current_setting('app.bypass_rls', true) = 'on')
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on')
  `.execute(db)
}

/**
 * `down` is mandatory while there is no real data. After the first real load,
 * a rollback is a new migration going forward, not a reversal.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS processed_commands`.execute(db)
  await sql`DROP TABLE IF EXISTS budgets`.execute(db)
  await sql`DROP TABLE IF EXISTS sessions`.execute(db)
  await sql`DROP TABLE IF EXISTS users`.execute(db)
}
