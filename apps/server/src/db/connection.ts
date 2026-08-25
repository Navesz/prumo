import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

/**
 * One pool. One transaction API. One way into the database.
 *
 * No other file constructs a pool. Two access paths is how you end up with two
 * transactions believing they are one — and here that means a job charged with
 * nothing in the ledger, or recorded with nothing charged.
 */

/**
 * The restricted role every runtime connection drops into. Created by migration
 * 0002. Nothing outside the migration pool should ever talk to Postgres as
 * anything else.
 */
export const APP_ROLE = 'prumo_app'

let installed = false

/**
 * The `pg` driver returns int8 (OID 20) as a STRING, because an int8 does not fit
 * in a JS number. Every money column in Prumo is a bigint, so without this the
 * ledger would add strings together and produce, silently, garbage.
 *
 * There is a test that proves this is on. A trap you fixed once and did not pin
 * down with a test is a trap you will meet again.
 */
export function installTypeParsers(): void {
  if (installed) return
  pg.types.setTypeParser(pg.types.builtins.INT8, (value) => BigInt(value))
  installed = true
}

export interface PoolOptions {
  readonly connectionString: string
  readonly max?: number
  readonly applicationName?: string
  /**
   * Role to drop into on every connection.
   *
   * This is not hardening around the edges — it is what makes row level security
   * work at all. PostgreSQL documents that a superuser, and any role with
   * BYPASSRLS, ALWAYS bypasses row security; `FORCE ROW LEVEL SECURITY` closes
   * the table-owner hole and not that one. The default compose sets
   * `POSTGRES_USER: prumo`, which IS the cluster superuser, so without this every
   * policy in the database is decoration and one user can read another's rows.
   *
   * Leave it undefined for the migration pool, which needs to be the owner.
   */
  readonly role?: string
}

export function createPool(options: PoolOptions): pg.Pool {
  installTypeParsers()

  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'prumo',
    // A connection that never times out is a connection that hides a dead
    // network from you until the pool is exhausted.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })

  if (options.role !== undefined) {
    const role = options.role
    pool.on('connect', (client) => {
      // `pg` queues every later query on this client behind this one, so the role
      // is dropped before any application query runs.
      //
      // On failure the connection is DESTROYED rather than returned to the pool.
      // A connection that could not drop its privileges is a connection still
      // holding them, and handing it back would silently serve queries with row
      // level security bypassed — the exact defect this whole mechanism exists to
      // prevent. Failing loudly is the only safe outcome.
      client.query(`SET ROLE ${quoteIdentifier(role)}`).catch((cause: unknown) => {
        client.emit(
          'error',
          new Error(`Could not SET ROLE ${role}; refusing to use this connection`, { cause }),
        )
      })
    })
  }

  return pool
}

/** The role name is ours, not user input — but building SQL by concatenation is
 *  a habit, and habits leak into places where the value is not ours. */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}

export type Db = Kysely<Database>
