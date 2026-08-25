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
  readonly period: 'month' | 'day'
  readonly periodStart: Date
  readonly periodEnd: Date
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
    period: 'month' | 'day'
    periodStart: Date
    periodEnd: Date
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
   * Zero rows affected means the cap was reached. There is no period between
   * checking and debiting, which is what makes eight models fired in the same
   * millisecond structurally unable to cross the limit.
   *
   * Never replace this with a SELECT followed by an UPDATE.
   */
  reserve(input: {
    userId: string
    period: 'month' | 'day'
    periodStart: Date
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
  readonly credentials: CredentialsRepo
  readonly catalog: CatalogRepo
}

// --- M2: the key vault ---------------------------------------------------------

export type CredentialKind = 'api_key' | 'oauth_refresh' | 'webhook_secret'
export type CredentialStatus = 'active' | 'invalid' | 'revoked'
export type KekProvider = 'env' | 'awskms' | 'gcpkms'

/**
 * The identity a credential is sealed AGAINST, recalculated from the row and
 * never stored. Moving a row to another user makes decryption fail.
 */
export interface AadParts {
  readonly id: string
  readonly userId: string
  readonly provider: string
  readonly kind: CredentialKind
}

export interface SealedSecret {
  readonly kekId: string
  readonly algorithm: 'AES-256-GCM'
  readonly wrappedDek: Buffer
  readonly dekNonce: Buffer
  readonly secretCiphertext: Buffer
  readonly secretNonce: Buffer
  readonly aadVersion: number
}

/**
 * A port, like every other. The use case never learns whether the key-encryption
 * key came from an environment variable or from a KMS — which is what makes
 * moving to a KMS a configuration change instead of a migration.
 */
export interface Vault {
  readonly kekId: string
  readonly provider: KekProvider
  seal(secret: string, parts: AadParts): SealedSecret
  open(sealed: SealedSecret, parts: AadParts): string
  fingerprint(secret: string): Buffer
  lastFour(secret: string): string
}

/**
 * What a screen is allowed to know about a stored key.
 *
 * There is no secret here and there is no route that returns one. A read path is
 * exactly what an authorization bug turns into a mass leak, and an XSS in the
 * front end would drain the vault through the user's own session.
 */
export interface CredentialSummary {
  readonly id: string
  readonly provider: string
  readonly kind: CredentialKind
  readonly label: string | null
  readonly lastFour: string
  readonly status: CredentialStatus
  readonly verifiedAt: Date | null
  readonly lastUsedAt: Date | null
  readonly createdAt: Date
}

export interface StoredCredential extends CredentialSummary {
  readonly userId: string
  readonly sealed: SealedSecret
}

export interface ProviderInfo {
  readonly slug: string
  readonly name: string
  readonly active: boolean
  readonly mode: 'sync' | 'queue' | 'both'
  readonly costInResponse: 'exact' | 'units' | 'none'
  readonly outputTtlSeconds: number | null
  readonly docUrl: string | null
  /** Compliance facts the user must see BEFORE spending. */
  readonly notice: string | null
}

export type CredentialAction =
  'created' | 'verified' | 'used' | 'auth_failed' | 'rewrapped' | 'revoked' | 'deleted'

export interface CredentialsRepo {
  listProviders(): Promise<ProviderInfo[]>
  findProvider(slug: string): Promise<ProviderInfo | null>

  listForUser(userId: string): Promise<CredentialSummary[]>
  /** The only path that returns sealed bytes, and it is reachable from the worker alone. */
  findActive(userId: string, provider: string): Promise<StoredCredential | null>
  findById(userId: string, id: string): Promise<StoredCredential | null>

  insert(input: {
    id: string
    userId: string
    provider: string
    kind: CredentialKind
    label: string | null
    kekProvider: KekProvider
    sealed: SealedSecret
    fingerprint: Buffer
    lastFour: string
  }): Promise<CredentialSummary>

  markVerified(id: string, at: Date): Promise<void>
  /** Three consecutive auth failures mark the credential invalid and stop burning attempts. */
  recordAuthFailure(id: string): Promise<number>
  revoke(id: string, at: Date): Promise<void>

  /** The audit trail. `detail` is FORBIDDEN to contain a secret, and CI greps for it. */
  recordEvent(input: {
    credentialId: string | null
    userId: string
    provider: string
    action: CredentialAction
    detail?: Record<string, unknown>
    ipHash: Buffer | null
  }): Promise<void>
}

/**
 * The outcome of a cheap "does this key work?" call.
 *
 * `no_probe` is deliberate and honest: six of the thirteen providers expose no
 * documented, free, GET-able endpoint that authenticates, so the key is stored,
 * `verified_at` stays null, and the screen says it could not be checked rather
 * than implying it was. A green tick that means nothing is worse than no tick.
 */
export type VerifyOutcome =
  | { readonly status: 'valid' }
  | { readonly status: 'invalid' }
  | { readonly status: 'no_credit' }
  /** A VALID key the provider refuses until identity verification completes. */
  | { readonly status: 'unverified_account' }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds?: number }
  | { readonly status: 'unavailable' }
  | { readonly status: 'no_probe' }

export interface CredentialVerifier {
  /** Never returns, throws or logs anything derived from the secret. */
  verify(input: { provider: string; secret: string }): Promise<VerifyOutcome>
}

// --- M3: the price index --------------------------------------------------------

export interface CatalogRow {
  readonly modelId: string
  readonly provider: string
  readonly providerName: string
  readonly name: string
  readonly family: string | null
  readonly tasks: readonly string[]
  readonly watermark: 'synthid' | 'none' | 'unknown'
  readonly thumbnailUrl: string | null
  /** Absent when the provider lists the model but publishes no price for it. */
  readonly price: {
    readonly basis: string
    readonly unitNano: bigint
    readonly tokensPerImage: number | null
    readonly formula: unknown
    readonly source: string
    readonly collectedAt: Date
    readonly method: 'doc' | 'api' | 'measured' | 'estimated'
    readonly note: string | null
  } | null
}

export interface CatalogRepo {
  /** Every model, with its current price. No user scope: nobody owns a price. */
  list(): Promise<CatalogRow[]>
}
