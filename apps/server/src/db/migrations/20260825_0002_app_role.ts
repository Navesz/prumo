import { sql, type Kysely } from 'kysely'

/**
 * The role the application actually runs as.
 *
 * Migration 0001 enabled and FORCED row level security, and that was not enough.
 * PostgreSQL documents it plainly: a superuser, and any role with BYPASSRLS,
 * **always** bypasses row security. `FORCE ROW LEVEL SECURITY` closes the
 * table-owner hole; it does not close the superuser hole.
 *
 * And the default deployment walks straight into it. `POSTGRES_USER: prumo` in
 * the compose file makes `prumo` the cluster superuser, so the app was connecting
 * as a superuser and every policy was decoration. The isolation test found this on
 * the first CI run — one user could read another user's rows.
 *
 * The fix is a second role. `prumo_app` has LOGIN off, BYPASSRLS off, no schema
 * ownership and no DDL. Every runtime connection does `SET ROLE prumo_app` right
 * after connecting, so `current_user` is a restricted role and the policies apply.
 * Migrations keep running as the owner, on a separate pool that is closed as soon
 * as they finish.
 *
 * If you change this, the assertion in `database.test.ts` that the runtime role is
 * not a superuser is what will tell you.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // CREATE ROLE has no IF NOT EXISTS, and a role is a cluster-level object that
  // survives a dropped database — so a re-run has to be tolerated.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prumo_app') THEN
        CREATE ROLE prumo_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE prumo_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $$
  `.execute(db)

  // The connecting user must be a member of the role in order to SET ROLE into it.
  await sql`GRANT prumo_app TO CURRENT_USER`.execute(db)

  await sql`GRANT USAGE ON SCHEMA public TO prumo_app`.execute(db)

  // Data, not structure. No CREATE, no ALTER, no DROP: the application never
  // performs DDL, and a role that cannot do it is a role that cannot be tricked
  // into doing it.
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prumo_app`.execute(
    db,
  )
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prumo_app`.execute(db)

  // Tables created by later migrations inherit the same grants, so nobody has to
  // remember to come back here. Forgetting would show up as a runtime permission
  // error on a table that was added months later.
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prumo_app
  `.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO prumo_app
  `.execute(db)

  // The ledger is append-only by design: "the counter says how much, never from
  // whom". The privilege is what makes that a property rather than a promise.
  // (No ledger table exists yet — this is the shape M3 inherits.)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM prumo_app
  `.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      REVOKE USAGE, SELECT ON SEQUENCES FROM prumo_app
  `.execute(db)
  await sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM prumo_app`.execute(db)
  await sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM prumo_app`.execute(db)
  await sql`REVOKE USAGE ON SCHEMA public FROM prumo_app`.execute(db)
  // The role itself is left in place: it is cluster-level and may be in use by
  // another database in the same cluster.
}
