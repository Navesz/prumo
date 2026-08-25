import { sql, type Kysely } from 'kysely'
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration'
import * as base from './migrations/20260824_0001_base.js'
import * as appRole from './migrations/20260825_0002_app_role.js'
import * as credentials from './migrations/20260825_0003_credentials.js'
import * as bootstrapCommands from './migrations/20260825_0004_bootstrap_commands.js'
import * as catalog from './migrations/20260825_0005_catalog.js'
import * as openrouter from './migrations/20260825_0006_openrouter.js'
import type { Database } from './schema.js'

/**
 * Migrations run AT BOOT, under a Postgres advisory lock.
 *
 * At boot, because it removes a container and a step from the self-host path:
 * `docker compose up -d` and the database is correct. Under an advisory lock,
 * because two replicas starting at the same second would otherwise race each
 * other through the same CREATE TABLE.
 *
 * The provider is a static object rather than a directory scan. A file scan
 * resolves differently between `node --experimental-strip-types src/` in
 * development and compiled `dist/` in production, and a migration that silently
 * fails to be found is the worst kind of deploy. Adding a migration means adding
 * a line here — which is also a diff a reviewer can see.
 */

/** Kysely orders lexicographically. The timestamp prefix is what keeps that honest. */
const migrations: Record<string, Migration> = {
  '20260824_0001_base': base,
  '20260825_0002_app_role': appRole,
  '20260825_0003_credentials': credentials,
  '20260825_0004_bootstrap_commands': bootstrapCommands,
  '20260825_0005_catalog': catalog,
  '20260825_0006_openrouter': openrouter,
}

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations
  }
}

/** Arbitrary but fixed. Any other process using this same key would be a bug. */
const ADVISORY_LOCK_KEY = 8_140_772_301n

export interface MigrateResult {
  readonly applied: string[]
  readonly current: string
}

export async function migrateToLatest(db: Kysely<Database>): Promise<MigrateResult> {
  const lock = await sql<{
    locked: boolean
  }>`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`.execute(db)

  if (!lock.rows[0]?.locked) {
    // Another instance is migrating. Waiting is correct: booting and serving
    // against a half-migrated schema is worse than starting slowly.
    await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`.execute(db)
  }

  try {
    const migrator = new Migrator({ db, provider: new StaticMigrationProvider() })
    const { error, results } = await migrator.migrateToLatest()

    if (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    const failed = results?.find((r) => r.status === 'Error')
    if (failed) {
      throw new Error(`Migration failed: ${failed.migrationName}`)
    }

    const applied = (results ?? [])
      .filter((r) => r.status === 'Success')
      .map((r) => r.migrationName)
    const names = Object.keys(migrations).sort()

    return { applied, current: names[names.length - 1] ?? '(none)' }
  } finally {
    await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.execute(db)
  }
}

export function latestMigrationName(): string {
  const names = Object.keys(migrations).sort()
  return names[names.length - 1] ?? '(none)'
}
