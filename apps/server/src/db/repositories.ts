import type { Transaction } from 'kysely'
import type {
  BudgetRecord,
  BudgetsRepo,
  CommandsRepo,
  NewUser,
  Repos,
  SessionsRepo,
  UserRecord,
  UsersRepo,
} from '../app/ports.js'
import type { BudgetRow, Database, UserRow } from './schema.js'

/**
 * Repositories.
 *
 * Every query that touches user-owned data filters by owner in the WHERE clause.
 * Never "fetch then check": a check after the fact is a check somebody forgets,
 * and row level security is the second door, not the first.
 */
export function makeRepos(trx: Transaction<Database>): Repos {
  return {
    users: makeUsers(trx),
    sessions: makeSessions(trx),
    budgets: makeBudgets(trx),
    commands: makeCommands(trx),
  }
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    role: row.role,
    active: row.active,
    timezone: row.timezone,
    createdAt: row.created_at,
  }
}

function makeUsers(trx: Transaction<Database>): UsersRepo {
  return {
    async countAll() {
      const row = await trx
        .selectFrom('users')
        .select(({ fn }) => fn.countAll<string>().as('total'))
        .executeTakeFirst()
      return Number(row?.total ?? 0)
    },

    async findByEmail(email) {
      const row = await trx
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst()
      return row ? toUser(row) : null
    },

    async findById(id) {
      const row = await trx.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
      return row ? toUser(row) : null
    },

    async insert(user: NewUser) {
      const row = await trx
        .insertInto('users')
        .values({
          id: user.id,
          email: user.email,
          password_hash: user.passwordHash,
          name: user.name,
          role: user.role,
          timezone: user.timezone,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      return toUser(row)
    },
  }
}

function makeSessions(trx: Transaction<Database>): SessionsRepo {
  return {
    async insert(input) {
      await trx
        .insertInto('sessions')
        .values({
          id: input.id,
          user_id: input.userId,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          ip_hash: input.ipHash,
          ua_hash: input.uaHash,
        })
        .execute()
    },

    async findLiveByTokenHash(tokenHash, now) {
      const row = await trx
        .selectFrom('sessions')
        .select(['id', 'user_id', 'expires_at'])
        .where('token_hash', '=', tokenHash)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .executeTakeFirst()

      return row ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at } : null
    },

    async touch(id, now) {
      await trx.updateTable('sessions').set({ last_used_at: now }).where('id', '=', id).execute()
    },

    async revoke(id, now) {
      await trx.updateTable('sessions').set({ revoked_at: now }).where('id', '=', id).execute()
    },
  }
}

function toBudget(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    capNano: row.cap_nano,
    reservedNano: row.reserved_nano,
    spentNano: row.spent_nano,
    exceededAt: row.exceeded_at,
    alertPercent: row.alert_percent,
  }
}

function makeBudgets(trx: Transaction<Database>): BudgetsRepo {
  return {
    async listForUser(userId, now) {
      const rows = await trx
        .selectFrom('budgets')
        .selectAll()
        .where('user_id', '=', userId)
        .where('period_end', '>', now)
        .orderBy('period')
        .execute()
      return rows.map(toBudget)
    },

    async upsertCap(input) {
      const row = await trx
        .insertInto('budgets')
        .values({
          id: input.id,
          user_id: input.userId,
          period: input.period,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          cap_nano: input.capNano,
        })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'period', 'period_start'])
            .doUpdateSet({ cap_nano: input.capNano, updated_at: new Date() }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()
      return toBudget(row)
    },

    /**
     * The spending cap. The condition of the rule is the condition of the write.
     *
     * Zero rows affected means the cap was reached — there is no separate check
     * to race against. Do not "improve" this into a SELECT plus an UPDATE.
     */
    async reserve(input) {
      const updated = await trx
        .updateTable('budgets')
        .set((eb) => ({
          reserved_nano: eb('reserved_nano', '+', input.costNano),
          updated_at: new Date(),
        }))
        .where('user_id', '=', input.userId)
        .where('period', '=', input.period)
        .where('period_start', '=', input.periodStart)
        .where((eb) =>
          eb(
            eb('spent_nano', '+', eb.ref('reserved_nano')),
            '<=',
            eb('cap_nano', '-', input.costNano),
          ),
        )
        .returning(['cap_nano', 'spent_nano', 'reserved_nano'])
        .executeTakeFirst()

      if (updated) {
        return {
          reserved: true,
          remainingNano: updated.cap_nano - updated.spent_nano - updated.reserved_nano,
        }
      }

      const current = await trx
        .selectFrom('budgets')
        .select(['cap_nano', 'spent_nano', 'reserved_nano'])
        .where('user_id', '=', input.userId)
        .where('period', '=', input.period)
        .where('period_start', '=', input.periodStart)
        .executeTakeFirst()

      const available = current ? current.cap_nano - current.spent_nano - current.reserved_nano : 0n

      return { reserved: false, availableNano: available < 0n ? 0n : available }
    },
  }
}

function makeCommands(trx: Transaction<Database>): CommandsRepo {
  return {
    async find(commandId) {
      const row = await trx
        .selectFrom('processed_commands')
        .select(['status', 'result'])
        .where('command_id', '=', commandId)
        .executeTakeFirst()
      return row ? { status: row.status, result: row.result } : null
    },

    async record(input) {
      await trx
        .insertInto('processed_commands')
        .values({
          command_id: input.commandId,
          user_id: input.userId,
          route: input.route,
          status: input.status,
          result: input.result as never,
        })
        .execute()
    },
  }
}
