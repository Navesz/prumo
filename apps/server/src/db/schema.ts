import type { ColumnType, Generated, Selectable } from 'kysely'

/**
 * The database types.
 *
 * Hand-written for now, and replaced by `kysely-codegen` running against a
 * database REBUILT FROM THE MIGRATIONS in CI — never against production.
 * Production drifts (a manual ALTER, an emergency index, a migration nobody
 * applied); generating types from it would turn that drift into the truth.
 * Production is COMPARED against git, never used to redefine it.
 *
 * Money columns are `bigint` on purpose. The `pg` driver hands int8 back as a
 * STRING, so `connection.ts` registers a type parser that returns a real bigint.
 * Without both halves — the parser AND this type — `spent + reserved` silently
 * concatenates two strings and the ledger is wrong with nothing red anywhere.
 */

type Timestamp = ColumnType<Date, Date | string, Date | string>

/**
 * A defaulted timestamp column. NOT `DefaultedTimestamp`: `Generated` is itself
 * a ColumnType, so nesting the two makes `Selectable` return the wrapper instead
 * of a Date — which type-checks everywhere and is wrong everywhere.
 */
type DefaultedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface UsersTable {
  id: string
  email: string
  password_hash: string | null
  name: string | null
  role: 'owner' | 'user'
  active: Generated<boolean>
  timezone: Generated<string>
  created_at: DefaultedTimestamp
  updated_at: DefaultedTimestamp
}

export interface SessionsTable {
  id: string
  user_id: string
  token_hash: Buffer
  expires_at: Timestamp
  last_used_at: Timestamp | null
  ip_hash: Buffer | null
  ua_hash: Buffer | null
  created_at: DefaultedTimestamp
  revoked_at: Timestamp | null
}

export interface BudgetsTable {
  id: string
  user_id: string
  period: 'month' | 'day'
  period_start: Timestamp
  period_end: Timestamp
  cap_nano: bigint
  reserved_nano: Generated<bigint>
  spent_nano: Generated<bigint>
  exceeded_at: Timestamp | null
  alert_percent: Generated<number>
  updated_at: DefaultedTimestamp
}

export interface ProcessedCommandsTable {
  command_id: string
  user_id: string | null
  route: string
  status: number
  result: unknown
  created_at: DefaultedTimestamp
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  budgets: BudgetsTable
  processed_commands: ProcessedCommandsTable
  provider: ProviderTable
  provider_credential: ProviderCredentialTable
  credential_event: CredentialEventTable
}

export type UserRow = Selectable<UsersTable>
export type SessionRow = Selectable<SessionsTable>
export type BudgetRow = Selectable<BudgetsTable>

// --- M2: the provider catalogue and the key vault ------------------------------

export interface ProviderTable {
  slug: string
  name: string
  active: DefaultedBoolean
  auth_style: 'bearer' | 'key' | 'x-api-key' | 'x-key' | 'x-goog-api-key'
  mode: 'sync' | 'queue' | 'both'
  concurrency_default: DefaultedNumber
  output_ttl_seconds: number | null
  cost_in_response: DefaultedCostSource
  doc_url: string | null
  notice: string | null
  verified_at: Timestamp | null
}

/**
 * The vault row.
 *
 * `secret_ciphertext` is never selected by any read path that reaches a route:
 * there is no endpoint that returns a secret, masked or otherwise. The screen
 * gets `last_four` and `verified_at`.
 */
export interface ProviderCredentialTable {
  id: string
  user_id: string
  provider: string
  kind: 'api_key' | 'oauth_refresh' | 'webhook_secret'
  label: string | null

  kek_provider: DefaultedKekProvider
  kek_id: string
  wrapped_dek: Buffer
  dek_nonce: Buffer
  secret_ciphertext: Buffer
  secret_nonce: Buffer
  aad_version: DefaultedNumber
  algorithm: DefaultedAlgorithm

  fingerprint: Buffer
  last_four: string

  status: DefaultedCredentialStatus
  auth_failures: DefaultedNumber
  verified_at: Timestamp | null
  last_used_at: Timestamp | null
  created_at: DefaultedTimestamp
  revoked_at: Timestamp | null
}

export interface CredentialEventTable {
  id: Generated<number>
  credential_id: string | null
  user_id: string
  provider: string
  action: 'created' | 'verified' | 'used' | 'auth_failed' | 'rewrapped' | 'revoked' | 'deleted'
  detail: unknown
  ip_hash: Buffer | null
  at: DefaultedTimestamp
}

type DefaultedBoolean = ColumnType<boolean, boolean | undefined, boolean>
type DefaultedNumber = ColumnType<number, number | undefined, number>
type DefaultedAlgorithm = ColumnType<'AES-256-GCM', 'AES-256-GCM' | undefined, 'AES-256-GCM'>
type DefaultedKekProvider = ColumnType<
  'env' | 'awskms' | 'gcpkms',
  'env' | 'awskms' | 'gcpkms' | undefined,
  'env' | 'awskms' | 'gcpkms'
>
type DefaultedCredentialStatus = ColumnType<
  'active' | 'invalid' | 'revoked',
  'active' | 'invalid' | 'revoked' | undefined,
  'active' | 'invalid' | 'revoked'
>
type DefaultedCostSource = ColumnType<
  'exact' | 'units' | 'none',
  'exact' | 'units' | 'none' | undefined,
  'exact' | 'units' | 'none'
>

export type ProviderRow = Selectable<ProviderTable>
export type ProviderCredentialRow = Selectable<ProviderCredentialTable>
