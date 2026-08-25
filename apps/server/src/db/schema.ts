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
}

export type UserRow = Selectable<UsersTable>
export type SessionRow = Selectable<SessionsTable>
export type BudgetRow = Selectable<BudgetsTable>
