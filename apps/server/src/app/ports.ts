/**
 * Ports: what the use cases are allowed to know about the outside world.
 *
 * Everything here is an interface. `app/` never imports a database instance, an
 * HTTP client, `fs` or an SDK — a boundary rule proves it, and that rule is what
 * mechanically enforces the most expensive invariant in the system: no external
 * I/O inside a transaction. A transaction that restarts re-runs its body, and
 * re-running a provider call means generating the image twice and being charged
 * twice. An external effect has no rollback.
 */

export interface Clock {
  now(): Date
}

export interface Ids {
  /** UUID v7: time-ordered, so keyset pagination and index locality come free. */
  next(): string
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>
  /** Constant-time, and safe to call with a null hash (an OAuth-only account). */
  verify(plain: string, hash: string | null): Promise<boolean>
}

export interface SessionTokens {
  /** Returns the token handed to the browser and the hash that is stored. */
  create(): { token: string; hash: Buffer }
  hash(token: string): Buffer
}

// --- repositories -------------------------------------------------------------

export interface NewUser {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly name: string | null
  readonly role: 'owner' | 'user'
  readonly timezone: string
}

export interface UserRecord {
  readonly id: string
  readonly email: string
  readonly passwordHash: string | null
  readonly name: string | null
  readonly role: 'owner' | 'user'
  readonly active: boolean
  readonly timezone: string
  readonly createdAt: Date
}

export interface UsersRepo {
  countAll(): Promise<number>
  findByEmail(email: string): Promise<UserRecord | null>
  findById(id: string): Promise<UserRecord | null>
  insert(user: NewUser): Promise<UserRecord>
}

export interface SessionRecord {
  readonly id: string
  readonly userId: string
  readonly expiresAt: Date
}

export interface SessionsRepo {
  insert(input: {
    id: string
    userId: string
    tokenHash: Buffer
    expiresAt: Date
    ipHash: Buffer | null
    uaHash: Buffer | null
  }): Promise<void>
  findLiveByTokenHash(tokenHash: Buffer, now: Date): Promise<SessionRecord | null>
  touch(id: string, now: Date): Promise<void>
  revoke(id: string, now: Date): Promise<void>
}

export interface BudgetRecord {
  readonly id: string
  readonly userId: string
  readonly window: 'month' | 'day'
  readonly windowStart: Date
  readonly windowEnd: Date
  readonly capNano: bigint
  readonly reservedNano: bigint
  readonly spentNano: bigint
  readonly exceededAt: Date | null
  readonly alertPercent: number
}

export interface BudgetsRepo {
  listForUser(userId: string, now: Date): Promise<BudgetRecord[]>
  upsertCap(input: {
    id: string
    userId: string
    window: 'month' | 'day'
    windowStart: Date
    windowEnd: Date
    capNano: bigint
  }): Promise<BudgetRecord>

  /**
   * The spending cap, and the only correct way to spend money in this system.
   *
   * The condition of the rule IS the condition of the write:
   *
   *   UPDATE budgets SET reserved_nano = reserved_nano + $cost
   *    WHERE ... AND spent_nano + reserved_nano + $cost <= cap_nano
   *
   * Zero rows affected means the cap was reached. There is no window between
   * checking and debiting, which is what makes eight models fired in the same
   * millisecond structurally unable to cross the limit.
   *
   * Never replace this with a SELECT followed by an UPDATE.
   */
  reserve(input: {
    userId: string
    window: 'month' | 'day'
    windowStart: Date
    costNano: bigint
  }): Promise<
    { reserved: true; remainingNano: bigint } | { reserved: false; availableNano: bigint }
  >
}

export interface CommandsRepo {
  find(commandId: string): Promise<{ status: number; result: unknown } | null>
  /** Only ever called on success. Caching a refusal locks the user out of retrying. */
  record(input: {
    commandId: string
    userId: string | null
    route: string
    status: number
    result: unknown
  }): Promise<void>
}

export interface Repos {
  readonly users: UsersRepo
  readonly sessions: SessionsRepo
  readonly budgets: BudgetsRepo
  readonly commands: CommandsRepo
}
