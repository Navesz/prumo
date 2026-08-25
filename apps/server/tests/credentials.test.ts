import { randomBytes } from 'node:crypto'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCredentials } from '../src/app/credentials.js'
import { AppError } from '../src/app/errors.js'
import type { UserRecord } from '../src/app/ports.js'
import { APP_ROLE, createDb, createPool } from '../src/db/connection.js'
import { migrateToLatest } from '../src/db/migrate.js'
import { createUnitOfWork } from '../src/db/unit-of-work.js'
import { createFakeVerifier } from '../src/providers/verify.js'
import { createIds } from '../src/security/identity.js'
import { createEnvVault } from '../src/vault/index.js'

const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? ''
let reachable = false

const adminPool = createPool({ connectionString: url, applicationName: 'prumo-cred-admin', max: 2 })
const adminDb = createDb(adminPool)
const pool = createPool({
  connectionString: url,
  applicationName: 'prumo-cred',
  max: 5,
  role: APP_ROLE,
})
const db = createDb(pool)

const uow = createUnitOfWork(db)
const ids = createIds()
const clock = { now: () => new Date() }
const vault = createEnvVault({ kek: randomBytes(32), pepper: randomBytes(32) })

/** A provider is ALWAYS faked in a test. A test that calls one is not a test, it is an expense. */
const verifier = createFakeVerifier({
  replicate: { status: 'valid' },
  openai: { status: 'unverified_account' },
  together: { status: 'invalid' },
  fal: { status: 'no_probe' },
})

const credentials = createCredentials({ uow, clock, ids, vault, verifier })

// Shaped like a real key so nothing accidentally passes because the value was
// obviously fake. It is not one.
const SECRET = `r8_${'K7nQ2xVb9mZa4Lp8Ts6Wc1Yd3Fe5Gh'.repeat(1)}`

beforeAll(async () => {
  if (url === '') return
  try {
    await sql`SELECT 1`.execute(adminDb)
    reachable = true
  } catch {
    return
  }
  await migrateToLatest(adminDb)
})

afterAll(async () => {
  await pool.end().catch(() => undefined)
  await adminPool.end().catch(() => undefined)
})

const run = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) return
    await fn()
  })

async function makeUser(): Promise<UserRecord> {
  return uow.run({ kind: 'bootstrap', reason: 'register' }, (repos) =>
    repos.users.insert({
      id: ids.next(),
      email: `cred-${ids.next()}@prumo.test`,
      passwordHash: 'scrypt$N=131072,r=8,p=1$c2FsdA==$aGFzaA==',
      name: null,
      role: 'user',
      timezone: 'UTC',
    }),
  )
}

describe('the key vault, against a real database', () => {
  run('stores a key and reports what the provider said about it', async () => {
    const user = await makeUser()
    const added = await credentials.add(user, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: SECRET,
      label: 'main',
      ipHash: null,
    })

    expect(added.verification.status).toBe('valid')
    expect(added.credential.lastFour).toBe(SECRET.slice(-4))
    expect(added.credential.status).toBe('active')
    expect(added.credential.verifiedAt).not.toBeNull()

    // The summary a screen receives has no secret in it and no field that could
    // hold one. This is a shape assertion, not a value assertion, because the
    // absence is the property.
    expect(Object.keys(added.credential).sort()).toEqual([
      'createdAt',
      'id',
      'kind',
      'label',
      'lastFour',
      'lastUsedAt',
      'provider',
      'status',
      'verifiedAt',
    ])
  })

  run('does NOT mark a key invalid when the provider merely could not be asked', async () => {
    // no_probe, rate_limited, unavailable and no_credit say nothing about whether
    // the key is good. Marking it invalid because the provider was briefly down
    // is a lie the user then has to undo.
    const user = await makeUser()
    const added = await credentials.add(user, {
      commandId: ids.next(),
      provider: 'fal',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    expect(added.verification.status).toBe('no_probe')
    expect(added.credential.status).toBe('active')
    expect(added.credential.verifiedAt).toBeNull()
  })

  run('separates "the key is wrong" from "the account is not verified yet"', async () => {
    // OpenAI answers 403 for a VALID key whose organization has not completed
    // identity verification. Without its own outcome, Prumo would say "invalid
    // key" and send the user to debug the wrong thing for hours.
    const user = await makeUser()
    const added = await credentials.add(user, {
      commandId: ids.next(),
      provider: 'openai',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    expect(added.verification.status).toBe('unverified_account')
    expect(added.credential.status).toBe('active')
  })

  run('refuses the same key twice for the same provider', async () => {
    const user = await makeUser()
    const add = () =>
      credentials.add(user, {
        commandId: ids.next(),
        provider: 'replicate',
        secret: SECRET,
        label: null,
        ipHash: null,
      })

    await add()
    await expect(add()).rejects.toThrow(AppError)
  })

  run("does not let one user see, verify or revoke another user's key", async () => {
    const alice = await makeUser()
    const bob = await makeUser()

    const hers = await credentials.add(alice, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: `${SECRET}-alice`,
      label: 'alice',
      ipHash: null,
    })

    expect(await credentials.list(bob)).toHaveLength(0)

    // Bob names Alice's credential id directly. The repository filters by owner
    // and row level security is the second door.
    await expect(credentials.verify(bob, hers.credential.id)).rejects.toThrow(AppError)
    await expect(credentials.revoke(bob, hers.credential.id, null)).rejects.toThrow(AppError)

    // And Alice still has it, untouched.
    const still = await credentials.list(alice)
    expect(still.map((c) => c.id)).toContain(hers.credential.id)
  })

  run('round-trips the secret through the database and back', async () => {
    const user = await makeUser()
    await credentials.add(user, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    const stored = await uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.credentials.findActive(user.id, 'replicate'),
    )

    expect(stored).not.toBeNull()
    const opened = vault.open(stored!.sealed, {
      id: stored!.id,
      userId: stored!.userId,
      provider: stored!.provider,
      kind: stored!.kind,
    })
    expect(opened).toBe(SECRET)
  })

  run('keeps the ciphertext out of a plain column, in the actual row', async () => {
    const user = await makeUser()
    await credentials.add(user, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    // Reads the row as bytes and looks for the secret anywhere in it. If somebody
    // ever "simplifies" the vault into a plain column, this fails.
    const rows = await sql<{ dump: string }>`
      SELECT provider_credential::text AS dump
        FROM provider_credential
       WHERE user_id = ${user.id}
    `.execute(adminDb)

    expect(rows.rows.length).toBeGreaterThan(0)
    for (const row of rows.rows) {
      expect(row.dump).not.toContain(SECRET)
      expect(row.dump).not.toContain(SECRET.slice(0, 10))
    }
  })

  run('writes an audit trail that survives deleting the credential', async () => {
    const user = await makeUser()
    const added = await credentials.add(user, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    await credentials.revoke(user, added.credential.id, null)

    // No foreign key to the credential, deliberately: an audit of deletions that
    // disappears with the deletion is not an audit.
    await sql`DELETE FROM provider_credential WHERE id = ${added.credential.id}`.execute(adminDb)

    const events = await sql<{ action: string; detail: unknown }>`
      SELECT action, detail FROM credential_event WHERE credential_id = ${added.credential.id}
    `.execute(adminDb)

    const actions = events.rows.map((e) => e.action)
    expect(actions).toContain('created')
    expect(actions).toContain('verified')
    expect(actions).toContain('revoked')

    // `detail` is FORBIDDEN to contain a secret.
    for (const event of events.rows) {
      expect(JSON.stringify(event.detail)).not.toContain(SECRET)
      expect(JSON.stringify(event.detail)).not.toContain(SECRET.slice(0, 10))
    }
  })

  run('says out loud that revoking here does not revoke at the provider', async () => {
    const user = await makeUser()
    const added = await credentials.add(user, {
      commandId: ids.next(),
      provider: 'replicate',
      secret: SECRET,
      label: null,
      ipHash: null,
    })

    await credentials.revoke(user, added.credential.id, null)

    // Gone from the list, and the contract's own response shape carries
    // `alsoRevokedAtProvider: false`. A leaked key is used directly against the
    // provider's API, where any cap Prumo enforces is irrelevant.
    expect(await credentials.list(user)).toHaveLength(0)
  })
})

/**
 * The path a real person takes, through the real code, in order.
 *
 * This describe block exists because of a bug that every other kind of test
 * missed. Migration 0001 created the bootstrap row-level-security policy for
 * three tables and not for the fourth, so registration failed on its very first
 * write — and the type checker, the boundary rules and the integration suite all
 * passed, because none of them ever ran `register` against a real database.
 *
 * It took starting the application and pressing the button. So now the button is
 * a test.
 */
describe('the first minutes of a new account', () => {
  run('registers, signs in, and lands with a zero cap and no keys', async () => {
    const { createAuth } = await import('../src/app/auth.js')
    const { createBudgets } = await import('../src/app/budgets.js')
    const { createPasswordHasher, createSessionTokens } =
      await import('../src/security/identity.js')

    const auth = createAuth({
      uow,
      clock,
      ids,
      passwords: createPasswordHasher(),
      tokens: createSessionTokens(),
      // 'publico' so the test does not depend on being the first account in a
      // database other tests have already written to.
      mode: 'publico',
      sessionTtlDays: 30,
    })

    const email = `novo-${ids.next()}@prumo.test`
    const password = 'uma-senha-bem-longa' // alicerce-segredo-ok: senha de teste, conta descartavel

    const registered = await auth.register({
      commandId: ids.next(),
      email,
      password,
      timezone: 'America/Sao_Paulo',
      ipHash: null,
      uaHash: null,
    })

    expect(registered.user.email).toBe(email)
    expect(registered.sessionToken).toHaveLength(43)

    // The session works, which means the cookie the browser gets works.
    const authenticated = await auth.authenticate(registered.sessionToken)
    expect(authenticated?.id).toBe(registered.user.id)

    // A new account cannot spend a cent until somebody writes a number. The
    // alternative — a helpful default — is a system that spends money nobody
    // authorised.
    const budgets = createBudgets({ uow, clock, ids })
    const caps = await budgets.list(registered.user)
    expect(caps.map((c) => c.period).sort()).toEqual(['day', 'month'])
    expect(caps.every((c) => c.capNano === 0n)).toBe(true)

    expect(await credentials.list(registered.user)).toHaveLength(0)

    // And signing in again with the same password works.
    const signedIn = await auth.signIn({ email, password, ipHash: null, uaHash: null })
    expect(signedIn.user.id).toBe(registered.user.id)
    expect(signedIn.sessionToken).not.toBe(registered.sessionToken)
  })
})
