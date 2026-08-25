import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBudgets } from '../src/app/budgets.js'
import type { UserRecord } from '../src/app/ports.js'
import { createDb, createPool } from '../src/db/connection.js'
import { migrateToLatest } from '../src/db/migrate.js'
import { createUnitOfWork } from '../src/db/unit-of-work.js'
import { createIds } from '../src/security/identity.js'

/**
 * The tests a mock cannot do.
 *
 * Row level security, the reservation race and the driver's bigint handling are
 * all properties of Postgres, not of our TypeScript. Testing them against a fake
 * would prove that the fake behaves — which is exactly the class of comfort that
 * lets a real isolation bug ship.
 *
 * They run against a real container. In CI that is the `postgres:17-alpine`
 * service; locally it is `docker compose up -d postgres`.
 */

// No credentials live in this repository, not even a local default. The URL
// comes from the environment; `tests/setup.ts` loads .env when there is one.
const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? ''

let reachable = false

const pool = createPool({ connectionString: url, applicationName: 'prumo-test', max: 5 })
const db = createDb(pool)
const uow = createUnitOfWork(db)
const ids = createIds()
const clock = { now: () => new Date() }

beforeAll(async () => {
  if (url === '') {
    process.stderr.write(
      [
        '',
        '[database.test] DATABASE_URL is not set. Copy .env.example to .env and run',
        '[database.test] `docker compose up -d postgres`. These assertions are the',
        '[database.test] ones a mock cannot make. SKIPPED.',
        '',
        '',
      ].join(String.fromCharCode(10)),
    )
    return
  }

  try {
    await sql`SELECT 1`.execute(db)
    reachable = true
  } catch {
    // Loud on purpose. A skipped integration suite that says nothing reads as a
    // green run, and "the isolation test passes" is an acceptance criterion.
    process.stderr.write(
      `\n[database.test] No Postgres at ${url}. Run \`docker compose up -d postgres\`.\n` +
        '[database.test] These assertions are the ones a mock cannot make. SKIPPED.\n\n',
    )
    return
  }

  await migrateToLatest(db)
  await sql`TRUNCATE users, sessions, budgets, processed_commands RESTART IDENTITY CASCADE`.execute(
    db,
  )
})

afterAll(async () => {
  await pool.end().catch(() => undefined)
})

const run = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) return
    await fn()
  })

async function makeUser(email: string): Promise<UserRecord> {
  return uow.run({ kind: 'bootstrap', reason: 'register' }, (repos) =>
    repos.users.insert({
      id: ids.next(),
      email,
      passwordHash: 'scrypt$N=131072,r=8,p=1$c2FsdA==$aGFzaA==',
      name: null,
      role: 'user',
      timezone: 'America/Sao_Paulo',
    }),
  )
}

describe('the database, for real', () => {
  run('hands back int8 as a bigint, not as a string', async () => {
    // Without the type parser this returns "9007199254740993" and the ledger
    // starts concatenating instead of adding — silently.
    const result = await sql<{ value: bigint }>`SELECT 9007199254740993::bigint AS value`.execute(
      db,
    )
    const value = result.rows[0]?.value

    expect(typeof value).toBe('bigint')
    expect(value).toBe(9_007_199_254_740_993n)
    expect((value as bigint) + 1n).toBe(9_007_199_254_740_994n)
  })

  run('stores and reads a nano-USD amount without losing a single unit', async () => {
    const user = await makeUser(`money-${ids.next()}@prumo.test`)
    const budgets = createBudgets({ uow, clock, ids })

    // 9,223,372,036 USD in nano-USD: the top of the bigint range.
    const cap = 9_223_372_036_854_775_807n
    const saved = await budgets.setCap(user, 'month', cap)

    expect(saved.capNano).toBe(cap)
  })

  run("does not let one user reach another user's data", async () => {
    // The acceptance criterion of M1. Without this the isolation is intent.
    const alice = await makeUser(`alice-${ids.next()}@prumo.test`)
    const bob = await makeUser(`bob-${ids.next()}@prumo.test`)

    const budgets = createBudgets({ uow, clock, ids })
    await budgets.setCap(alice, 'month', 10_000_000_000n)
    await budgets.setCap(bob, 'month', 20_000_000_000n)

    const aliceSees = await budgets.list(alice)
    expect(aliceSees.every((budget) => budget.userId === alice.id)).toBe(true)

    // And the direct attempt: inside Bob's scope, ask for every budget row there
    // is. Row level security must answer with Bob's rows only, even though the
    // query has no WHERE clause of its own.
    const everything = await uow.run({ kind: 'user', userId: bob.id }, async () => {
      const rows = await sql<{ user_id: string }>`SELECT user_id FROM budgets`.execute(db)
      return rows.rows
    })

    expect(everything.length).toBeGreaterThan(0)
    expect(everything.every((row) => row.user_id === bob.id)).toBe(true)
    expect(everything.some((row) => row.user_id === alice.id)).toBe(false)
  })

  run('forces row level security even for the table owner', async () => {
    // The trap: without FORCE, the owner bypasses every policy — and in the
    // default compose the app connects AS the owner. The isolation would have
    // been decoration from day one.
    const rows = await sql<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
       WHERE relname IN ('users', 'sessions', 'budgets', 'processed_commands')
    `.execute(db)

    expect(rows.rows).toHaveLength(4)
    for (const row of rows.rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS enabled`).toBe(true)
      expect(row.relforcerowsecurity, `${row.relname} FORCES RLS`).toBe(true)
    }
  })

  run('lets exactly one of two concurrent runs take the last cent of the cap', async () => {
    // The race the whole design exists to make impossible. Two batches, one cent
    // of headroom, fired at the same time. One wins. Never both, never neither.
    const user = await makeUser(`race-${ids.next()}@prumo.test`)
    const budgets = createBudgets({ uow, clock, ids })

    const cap = 10_000_000n // US$ 0.01
    const budget = await budgets.setCap(user, 'month', cap)

    const attempt = () =>
      uow.run({ kind: 'user', userId: user.id }, (repos) =>
        repos.budgets.reserve({
          userId: user.id,
          period: 'month',
          periodStart: budget.periodStart,
          costNano: cap,
        }),
      )

    const [first, second] = await Promise.all([attempt(), attempt()])
    const winners = [first, second].filter((result) => result.reserved).length

    expect(winners).toBe(1)

    const after = await budgets.list(user)
    const month = after.find((b) => b.period === 'month')
    expect(month?.reservedNano).toBe(cap)
    expect((month?.reservedNano ?? 0n) + (month?.spentNano ?? 0n)).toBeLessThanOrEqual(cap)
  })

  run('reports how much was left when it refuses', async () => {
    const user = await makeUser(`headroom-${ids.next()}@prumo.test`)
    const budgets = createBudgets({ uow, clock, ids })
    const budget = await budgets.setCap(user, 'month', 1_000_000n)

    const refused = await uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.budgets.reserve({
        userId: user.id,
        period: 'month',
        periodStart: budget.periodStart,
        costNano: 5_000_000n,
      }),
    )

    expect(refused.reserved).toBe(false)
    if (!refused.reserved) {
      // The screen needs this number to offer "generate only the cheapest N".
      expect(refused.availableNano).toBe(1_000_000n)
    }
  })

  run('refuses a second command with the same id', async () => {
    const user = await makeUser(`idem-${ids.next()}@prumo.test`)
    const commandId = ids.next()

    const record = () =>
      uow.run({ kind: 'user', userId: user.id }, (repos) =>
        repos.commands.record({
          commandId,
          userId: user.id,
          route: 'test',
          status: 200,
          result: { ok: true },
        }),
      )

    await record()
    await expect(record()).rejects.toThrow()

    const found = await uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.commands.find(commandId),
    )
    expect(found?.status).toBe(200)
  })
})
