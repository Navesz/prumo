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
}

export function createPool(options: PoolOptions): pg.Pool {
  installTypeParsers()

  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'prumo',
    // A connection that never times out is a connection that hides a dead
    // network from you until the pool is exhausted.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}

export type Db = Kysely<Database>
