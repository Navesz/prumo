/**
 * Where a spending period begins, in the user's own timezone.
 *
 * This is not a detail. The Herz codebase carries a recorded bug (finding A2) of
 * comparing a local day against UTC midnight, in a system whose whole job is
 * measuring time. Here the same mistake hands somebody a cap that resets on the
 * wrong day — which, at the turn of the month, means releasing money that should
 * not have been available.
 *
 * Pure: no clock of its own, no I/O. The instant always arrives as an argument.
 */

export type PeriodKind = 'month' | 'day'

export interface SpendPeriod {
  readonly kind: PeriodKind
  readonly start: Date
  readonly end: Date
}

export class TimezoneError extends Error {
  override readonly name = 'TimezoneError'
}

/**
 * The offset of `timeZone` at a given instant, in minutes east of UTC.
 *
 * Derived from `Intl`, so the IANA database that ships with Node is the single
 * source of truth. No offset table of our own to go stale.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    if (!found) throw new TimezoneError(`Intl gave no ${type} for ${timeZone}`)
    return Number(found.value)
  }

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  )

  // Intl renders hour 24 for midnight in some locales; Date.UTC normalises it.
  return Math.round((asUtc - instant.getTime()) / 60_000)
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached

  let created: Intl.DateTimeFormat
  try {
    created = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    throw new TimezoneError(`Unknown IANA timezone: ${timeZone}`)
  }

  formatters.set(timeZone, created)
  return created
}

/**
 * The UTC instant for a wall-clock time in `timeZone`.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first pass uses the offset at the naive guess, the second re-reads it at
 * the corrected instant — which is what makes a DST boundary come out right.
 */
function fromWallClock(timeZone: string, year: number, month: number, day: number): Date {
  const wallUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0)

  let instant = new Date(wallUtc - offsetMinutes(new Date(wallUtc), timeZone) * 60_000)
  instant = new Date(wallUtc - offsetMinutes(instant, timeZone) * 60_000)

  return instant
}

/** The calendar date, in `timeZone`, of a given instant. */
export function zonedDate(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = formatter(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    if (!found) throw new TimezoneError(`Intl gave no ${type} for ${timeZone}`)
    return Number(found.value)
  }
  return { year: read('year'), month: read('month'), day: read('day') }
}

export function monthPeriod(instant: Date, timeZone: string): SpendPeriod {
  const { year, month } = zonedDate(instant, timeZone)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    kind: 'month',
    start: fromWallClock(timeZone, year, month, 1),
    end: fromWallClock(timeZone, nextYear, nextMonth, 1),
  }
}

/**
 * The day cap.
 *
 * Named "day" and not "session" on purpose. A session cap sounds like it follows
 * a browser tab, and a background worker that keeps generating after the tab
 * closes would make that name a lie. "Since midnight where you live" is something
 * both the code and the user can point at.
 */
export function dayPeriod(instant: Date, timeZone: string): SpendPeriod {
  const { year, month, day } = zonedDate(instant, timeZone)
  const start = fromWallClock(timeZone, year, month, day)

  // Adding 24 hours would be wrong across a DST change. Ask for the next
  // calendar day and let the timezone decide how long today actually was.
  const nextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000)
  const next = zonedDate(nextDay, timeZone)

  return {
    kind: 'day',
    start,
    end: fromWallClock(timeZone, next.year, next.month, next.day),
  }
}

export function periodFor(kind: PeriodKind, instant: Date, timeZone: string): SpendPeriod {
  return kind === 'month' ? monthPeriod(instant, timeZone) : dayPeriod(instant, timeZone)
}
