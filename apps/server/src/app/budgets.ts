import { periodFor, type PeriodKind } from '../domain/periods.js'
import type { BudgetRecord, Clock, Ids, UserRecord } from './ports.js'
import type { UnitOfWork } from './unit-of-work.js'

export interface BudgetDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: Ids
}

export function createBudgets(deps: BudgetDeps) {
  const { uow, clock, ids } = deps

  /**
   * Lists the caller's own budgets, creating the current windows if the month or
   * the day has rolled over since the last visit.
   *
   * The windows are computed in the USER'S timezone, never UTC. Getting this
   * wrong releases money at the turn of the month — it is the same class of
   * mistake as comparing a local day against UTC midnight.
   */
  async function list(user: UserRecord): Promise<BudgetRecord[]> {
    const now = clock.now()

    return uow.run({ kind: 'user', userId: user.id }, async (repos) => {
      const existing = await repos.budgets.listForUser(user.id, now)
      const byWindow = new Map(existing.map((b) => [b.period, b]))
      const result: BudgetRecord[] = []

      for (const kind of ['month', 'day'] as const) {
        const span = periodFor(kind, now, user.timezone)
        const current = byWindow.get(kind)

        if (current && current.periodStart.getTime() === span.start.getTime()) {
          result.push(current)
          continue
        }

        // A new period. The cap carries over from the previous one — a user who
        // set a cap last month meant it as a policy, not as a one-off — but the
        // spent and reserved counters start at zero because they belong to the
        // period, not to the person.
        result.push(
          await repos.budgets.upsertCap({
            id: ids.next(),
            userId: user.id,
            period: kind,
            periodStart: span.start,
            periodEnd: span.end,
            capNano: current?.capNano ?? 0n,
          }),
        )
      }

      return result
    })
  }

  async function setCap(
    user: UserRecord,
    kind: PeriodKind,
    capNano: bigint,
  ): Promise<BudgetRecord> {
    const now = clock.now()
    const span = periodFor(kind, now, user.timezone)

    return uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.budgets.upsertCap({
        id: ids.next(),
        userId: user.id,
        period: kind,
        periodStart: span.start,
        periodEnd: span.end,
        capNano,
      }),
    )
  }

  return { list, setCap }
}

export type Budgets = ReturnType<typeof createBudgets>
