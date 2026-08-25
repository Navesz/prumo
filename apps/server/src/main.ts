import { sql } from 'kysely'
import { createAuth } from './app/auth.js'
import { createBudgets } from './app/budgets.js'
import { createCredentials } from './app/credentials.js'
import { ConfigError, loadConfig } from './config.js'
import { APP_ROLE, createDb, createPool } from './db/connection.js'
import { migrateToLatest } from './db/migrate.js'
import { createUnitOfWork } from './db/unit-of-work.js'
import { createServer } from './http/server.js'
import { createHttpVerifier } from './providers/verify.js'
import { createEnvVault } from './vault/index.js'
import {
  createIds,
  createPasswordHasher,
  createSessionTokens,
  keyedHash,
} from './security/identity.js'

/**
 * One binary. HTTP, the worker and SSE, selected by PRUMO_PAPEL.
 *
 * The role exists so that splitting the API from the worker later is a compose
 * line rather than a refactor. The code is already separable — the boundary
 * rules prove it — while the deployment stays a single thing to watch.
 */
async function main(): Promise<void> {
  const config = loadConfig()

  // Two pools, and the split is a security boundary rather than tidiness.
  //
  // Migrations need the owner: CREATE TABLE, CREATE EXTENSION, CREATE ROLE. The
  // application must NOT run as the owner, because in the default deployment the
  // owner is the cluster superuser, and a superuser ALWAYS bypasses row level
  // security no matter how many policies are FORCED. So the admin pool opens,
  // migrates, and closes before the app pool exists.
  //
  // Migrations run here, before anything can serve a request against a schema
  // that is not there yet. Under an advisory lock, so two replicas starting in
  // the same second do not race each other.
  const adminPool = createPool({
    connectionString: config.databaseUrl,
    applicationName: 'prumo-migrate',
    max: 2,
  })

  const migration = await migrateToLatest(createDb(adminPool))
  if (migration.applied.length > 0) {
    process.stdout.write(`applied migrations: ${migration.applied.join(', ')}\n`)
  }
  await adminPool.end()

  const pool = createPool({
    connectionString: config.databaseUrl,
    applicationName: 'prumo',
    role: APP_ROLE,
  })
  const db = createDb(pool)

  const uow = createUnitOfWork(db)
  const clock = { now: () => new Date() }
  const ids = createIds()

  const auth = createAuth({
    uow,
    clock,
    ids,
    passwords: createPasswordHasher(),
    tokens: createSessionTokens(),
    mode: config.mode,
    sessionTtlDays: 30,
  })

  const budgets = createBudgets({ uow, clock, ids })

  // The KEK lives here and nowhere else. It is read once, at boot, from a config
  // object that never logs it, and it does not leave this closure.
  const credentials = createCredentials({
    uow,
    clock,
    ids,
    vault: createEnvVault({ kek: config.kek, pepper: config.pepper }),
    verifier: createHttpVerifier(),
  })

  const checkDatabase = async (): Promise<boolean> => {
    try {
      await sql`SELECT 1`.execute(db)
      return true
    } catch {
      return false
    }
  }

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\n${signal} received, draining\n`)
    await pool.end().catch(() => undefined)
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  if (config.runsWorker) {
    // The worker loop arrives with M4, when there is a task table to drain.
    // Announcing the role now keeps the topology honest in the logs.
    process.stdout.write('worker role enabled (no tasks to run until M4)\n')
  }

  if (!config.servesHttp) {
    process.stdout.write('PRUMO_PAPEL=worker: not serving HTTP\n')
    return
  }

  const app = await createServer({
    config,
    auth,
    budgets,
    credentials,
    checkDatabase,
    hashClientHint: (value) => keyedHash(config.pepper, value),
  })

  await app.listen({ host: config.host, port: config.port })
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    // A config error is a human's problem, not a stack trace. Print the message
    // and nothing else — the whole point is that it names what is missing.
    process.stderr.write(`\n${error.message}\n`)
    process.exit(78) // EX_CONFIG
  }

  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
