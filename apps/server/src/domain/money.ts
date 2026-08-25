/**
 * Money. Integer nano-USD (1 = 1e-9 USD) in a bigint, always.
 *
 * Pure: no I/O, no clock, no randomness. It is the layer the boundary rules keep
 * free of everything, so that a wrong amount is a failing unit test and not a
 * charge on somebody's card.
 */

/** 1 USD in nano-USD. */
export const NANO_PER_USD = 1_000_000_000n

/** bigint covers about ±9.2 billion USD in nano-USD. Anything past that is a bug, not a purchase. */
const MAX_NANO = 9_223_372_036_854_775_807n

export class MoneyError extends Error {
  override readonly name = 'MoneyError'
}

/**
 * Parse the wire format: a base-10 integer written as a string.
 *
 * This is also the guard against the `pg` driver's int8 behaviour. The driver
 * hands back bigint columns as STRINGS, so without an explicit parse the ledger
 * would concatenate instead of adding — silently, and only visibly wrong once
 * somebody compares the total to their invoice.
 */
export function parseNano(value: string | bigint | number): bigint {
  if (typeof value === 'bigint') return assertInRange(value)

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`Money must not arrive as a float or an unsafe integer: ${value}`)
    }
    return assertInRange(BigInt(value))
  }

  if (!/^-?(0|[1-9]\d{0,18})$/.test(value)) {
    throw new MoneyError(`Not a base-10 integer amount: ${JSON.stringify(value)}`)
  }

  return assertInRange(BigInt(value))
}

function assertInRange(value: bigint): bigint {
  if (value > MAX_NANO || value < -MAX_NANO) {
    throw new MoneyError(`Amount out of range for bigint storage: ${value}`)
  }
  return value
}

/** The wire and storage format. */
export function formatNano(value: bigint): string {
  return value.toString(10)
}

/**
 * Human display, and only that.
 *
 * The ledger stays in nano-USD; rounding happens at the edge of the screen and
 * never on the way into the database.
 */
export function toUsdString(value: bigint, fractionDigits = 4): string {
  const negative = value < 0n
  const absolute = negative ? -value : value

  const whole = absolute / NANO_PER_USD
  const remainder = absolute % NANO_PER_USD

  const fraction = remainder.toString().padStart(9, '0').slice(0, fractionDigits)
  const sign = negative ? '-' : ''

  return fractionDigits === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

/** US$ 0.15 → 150000000n. Accepts a string so no float ever enters the pipeline. */
export function fromUsdString(usd: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{1,9}))?$/.exec(usd.trim())
  if (!match) throw new MoneyError(`Not a USD amount: ${JSON.stringify(usd)}`)

  const [, sign, whole = '0', fraction = ''] = match
  const nano = BigInt(whole) * NANO_PER_USD + BigInt(fraction.padEnd(9, '0'))

  return assertInRange(sign === '-' ? -nano : nano)
}

/** Reject a negative cap at the edge, where the message can still be useful. */
export function assertNonNegative(value: bigint, what: string): bigint {
  if (value < 0n) throw new MoneyError(`${what} cannot be negative: ${value}`)
  return value
}
