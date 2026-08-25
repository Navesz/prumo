import { periodFor } from '../domain/periods.js'
import { fail } from './errors.js'
import type { Clock, Ids, PasswordHasher, SessionTokens, UserRecord } from './ports.js'
import type { UnitOfWork } from './unit-of-work.js'

export interface AuthDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: Ids
  readonly passwords: PasswordHasher
  readonly tokens: SessionTokens
  /** 'pessoal' closes registration once the first account exists. */
  readonly mode: 'pessoal' | 'publico'
  readonly sessionTtlDays: number
}

export interface SignedIn {
  readonly user: UserRecord
  /** Handed to the browser once. Only its SHA-256 reaches the database. */
  readonly sessionToken: string
  readonly expiresAt: Date
}

export interface RegisterInput {
  readonly commandId: string
  readonly email: string
  readonly password: string
  readonly name?: string | undefined
  readonly timezone: string
  readonly ipHash: Buffer | null
  readonly uaHash: Buffer | null
}

export function createAuth(deps: AuthDeps) {
  const { uow, clock, ids, passwords, tokens, mode, sessionTtlDays } = deps

  /**
   * Hashing happens BEFORE the transaction opens, deliberately.
   *
   * scrypt at N=2^17 takes on the order of a hundred milliseconds. Holding a
   * database transaction open across that pins a pooled connection for no reason
   * and makes lock contention worse under exactly the load where it matters.
   */
  async function register(input: RegisterInput): Promise<SignedIn> {
    const now = clock.now()

    const precheck = await uow.run({ kind: 'bootstrap', reason: 'register' }, async (repos) => {
      const replay = await repos.commands.find(input.commandId)
      if (replay) return { replay: true as const }

      if (mode === 'pessoal' && (await repos.users.countAll()) > 0) throw fail.registrationClosed()
      if (await repos.users.findByEmail(input.email)) throw fail.emailTaken()

      return { replay: false as const, first: (await repos.users.countAll()) === 0 }
    })

    if (precheck.replay) {
      // The command already ran. Re-issuing a session here would be wrong: the
      // first run already handed one out. Sign in instead.
      throw fail.emailTaken()
    }

    const passwordHash = await passwords.hash(input.password)
    const session = tokens.create()
    const expiresAt = new Date(now.getTime() + sessionTtlDays * 24 * 60 * 60 * 1000)

    const user = await uow.run({ kind: 'bootstrap', reason: 'register' }, async (repos) => {
      // Re-checked inside the transaction. The check above is for a good error
      // message; the unique index is what actually decides, and it is what makes
      // two simultaneous registrations of the same address safe.
      if (mode === 'pessoal' && (await repos.users.countAll()) > 0) throw fail.registrationClosed()

      const created = await repos.users.insert({
        id: ids.next(),
        email: input.email,
        passwordHash,
        name: input.name ?? null,
        role: precheck.first ? 'owner' : 'user',
        timezone: input.timezone,
      })

      await repos.sessions.insert({
        id: ids.next(),
        userId: created.id,
        tokenHash: session.hash,
        expiresAt,
        ipHash: input.ipHash,
        uaHash: input.uaHash,
      })

      // Budgets start at a cap of ZERO, on purpose. A new account cannot spend a
      // cent until somebody sets a number. The alternative — a helpful default —
      // is a system that spends money nobody authorised.
      for (const kind of ['month', 'day'] as const) {
        const span = periodFor(kind, now, created.timezone)
        await repos.budgets.upsertCap({
          id: ids.next(),
          userId: created.id,
          period: kind,
          periodStart: span.start,
          periodEnd: span.end,
          capNano: 0n,
        })
      }

      await repos.commands.record({
        commandId: input.commandId,
        userId: created.id,
        route: 'auth.register',
        status: 200,
        result: { userId: created.id },
      })

      return created
    })

    return { user, sessionToken: session.token, expiresAt }
  }

  async function signIn(input: {
    email: string
    password: string
    ipHash: Buffer | null
    uaHash: Buffer | null
  }): Promise<SignedIn> {
    const now = clock.now()

    const found = await uow.run({ kind: 'bootstrap', reason: 'sign-in' }, (repos) =>
      repos.users.findByEmail(input.email),
    )

    // Verification runs even when the account does not exist, against a null
    // hash that burns comparable time. Otherwise the response time tells an
    // attacker which addresses have accounts.
    const ok = await passwords.verify(input.password, found?.passwordHash ?? null)
    if (!found || !ok || !found.active) throw fail.invalidCredentials()

    const session = tokens.create()
    const expiresAt = new Date(now.getTime() + sessionTtlDays * 24 * 60 * 60 * 1000)

    await uow.run({ kind: 'user', userId: found.id }, (repos) =>
      repos.sessions.insert({
        id: ids.next(),
        userId: found.id,
        tokenHash: session.hash,
        expiresAt,
        ipHash: input.ipHash,
        uaHash: input.uaHash,
      }),
    )

    return { user: found, sessionToken: session.token, expiresAt }
  }

  async function authenticate(token: string | undefined): Promise<UserRecord | null> {
    if (!token) return null

    const now = clock.now()
    const tokenHash = tokens.hash(token)

    return uow.run({ kind: 'bootstrap', reason: 'sign-in' }, async (repos) => {
      const session = await repos.sessions.findLiveByTokenHash(tokenHash, now)
      if (!session) return null

      const user = await repos.users.findById(session.userId)
      if (!user || !user.active) return null

      await repos.sessions.touch(session.id, now)
      return user
    })
  }

  async function signOut(token: string | undefined): Promise<void> {
    if (!token) return

    const now = clock.now()
    const tokenHash = tokens.hash(token)

    await uow.run({ kind: 'bootstrap', reason: 'sign-in' }, async (repos) => {
      const session = await repos.sessions.findLiveByTokenHash(tokenHash, now)
      if (session) await repos.sessions.revoke(session.id, now)
    })
  }

  async function registrationOpen(): Promise<boolean> {
    if (mode === 'publico') return true
    const total = await uow.run({ kind: 'bootstrap', reason: 'sign-in' }, (repos) =>
      repos.users.countAll(),
    )
    return total === 0
  }

  return { register, signIn, signOut, authenticate, registrationOpen }
}

export type Auth = ReturnType<typeof createAuth>
