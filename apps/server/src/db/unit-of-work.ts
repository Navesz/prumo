import { sql, type Transaction } from 'kysely'
import type { Repos } from '../app/ports.js'
import type { Scope, UnitOfWork } from '../app/unit-of-work.js'
import { makeRepos } from './repositories.js'
import type { Database } from './schema.js'
import type { Db } from './connection.js'

/**
 * The implementation. The interface lives in `app/`; this is the only file that
 * calls `db.transaction()` and the only one that runs `SET LOCAL`.
 *
 * `SET LOCAL` and not `SET`: the setting must die with the transaction. A pooled
 * connection that keeps `app.user_id` from a previous request would serve one
 * user's rows to the next one — the exact failure RLS exists to prevent.
 */
export function createUnitOfWork(db: Db): UnitOfWork {
  return {
    async run<T>(scope: Scope, fn: (repos: Repos) => Promise<T>): Promise<T> {
      return db.transaction().execute(async (trx: Transaction<Database>) => {
        await applyScope(trx, scope)
        return fn(makeRepos(trx))
      })
    },
  }
}

async function applyScope(trx: Transaction<Database>, scope: Scope): Promise<void> {
  if (scope.kind === 'user') {
    // set_config with `true` for is_local is the parameterised form of SET LOCAL.
    // SET LOCAL itself does not accept a bind parameter, and building the
    // statement by string concatenation would be an injection point sitting in
    // the one place that decides who sees what.
    await sql`SELECT set_config('app.user_id', ${scope.userId}, true)`.execute(trx)
    await sql`SELECT set_config('app.bypass_rls', 'off', true)`.execute(trx)
    return
  }

  await sql`SELECT set_config('app.user_id', '', true)`.execute(trx)
  await sql`SELECT set_config('app.bypass_rls', 'on', true)`.execute(trx)
}
