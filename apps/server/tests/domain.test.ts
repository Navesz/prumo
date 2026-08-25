import { describe, expect, it } from 'vitest'
import {
  assertNonNegative,
  formatNano,
  fromUsdString,
  MoneyError,
  parseNano,
  toUsdString,
} from '../src/domain/money.js'
import { dayPeriod, monthPeriod, TimezoneError } from '../src/domain/periods.js'

describe('money', () => {
  it('keeps precision that a float would destroy', () => {
    // US$ 0.0005 is a real price. In a float pipeline this is where two routes
    // with different prices collapse into the same number.
    expect(fromUsdString('0.0005')).toBe(500_000n)
    expect(fromUsdString('0.15')).toBe(150_000_000n)
    expect(fromUsdString('0.000000001')).toBe(1n)

    // The classic float failure, proven not to happen here.
    expect(fromUsdString('0.1') + fromUsdString('0.2')).toBe(fromUsdString('0.3'))
  })

  it('refuses a float, an unsafe integer and a decimal string', () => {
    expect(() => parseNano(0.1)).toThrow(MoneyError)
    expect(() => parseNano(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError)
    expect(() => parseNano('1.5')).toThrow(MoneyError)
    expect(() => parseNano('01')).toThrow(MoneyError)
    expect(() => parseNano('abc')).toThrow(MoneyError)
  })

  it('accepts the string the pg driver hands back for an int8 column', () => {
    // The driver returns bigint columns as strings. Without a parse at the
    // boundary, `spent + reserved` concatenates instead of adding.
    expect(parseNano('9007199254740993')).toBe(9_007_199_254_740_993n)
    expect(parseNano('9007199254740993') + 1n).toBe(9_007_199_254_740_994n)

    // And the failure mode being guarded against, stated out loud:
    const asStrings = '9007199254740993' + '1'
    expect(asStrings).not.toBe(String(9_007_199_254_740_993n + 1n))
  })

  it('rejects an amount that would not fit in a bigint column', () => {
    expect(() => parseNano('9223372036854775808')).toThrow(MoneyError)
  })

  it('round-trips through the wire format', () => {
    for (const value of ['0', '1', '-1', '150000000', '9223372036854775807']) {
      expect(formatNano(parseNano(value))).toBe(value)
    }
  })

  it('rounds only for display, never on the way in', () => {
    expect(toUsdString(150_000_000n)).toBe('0.1500')
    expect(toUsdString(500_000n)).toBe('0.0005')
    expect(toUsdString(1_000_000_000n, 2)).toBe('1.00')
    expect(toUsdString(-150_000_000n, 2)).toBe('-0.15')
  })

  it('refuses a negative spending cap where the message still helps', () => {
    expect(() => assertNonNegative(-1n, 'A spending cap')).toThrow(/cannot be negative/)
    expect(assertNonNegative(0n, 'A spending cap')).toBe(0n)
  })
})

describe('spending periods', () => {
  const SP = 'America/Sao_Paulo'

  it('starts the month at local midnight, not UTC midnight', () => {
    // 1 August 2026, 02:00 UTC is still 31 July, 23:00 in Sao Paulo. A UTC-based
    // period would already have rolled over and released the cap a day early.
    const instant = new Date('2026-08-01T02:00:00Z')
    const july = monthPeriod(instant, SP)

    expect(july.start.toISOString()).toBe('2026-07-01T03:00:00.000Z')
    expect(july.end.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(july.start.getTime()).toBeLessThan(instant.getTime())
  })

  it('agrees with UTC when the user lives in UTC', () => {
    const period = monthPeriod(new Date('2026-08-01T02:00:00Z'), 'UTC')
    expect(period.start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('wraps December into the next year', () => {
    const period = monthPeriod(new Date('2026-12-15T12:00:00Z'), 'UTC')
    expect(period.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('keeps a day exactly one calendar day long, including across a DST change', () => {
    // New York moves its clocks on 8 March 2026, so that local day is 23 hours.
    // Adding 24 hours would land an hour into the next day.
    const period = dayPeriod(new Date('2026-03-08T12:00:00Z'), 'America/New_York')
    const hours = (period.end.getTime() - period.start.getTime()) / 3_600_000

    expect(hours).toBe(23)
    expect(period.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it('contains the instant it was asked about', () => {
    for (const zone of [SP, 'UTC', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney']) {
      const instant = new Date('2026-08-24T23:30:00Z')
      for (const period of [monthPeriod(instant, zone), dayPeriod(instant, zone)]) {
        expect(period.start.getTime()).toBeLessThanOrEqual(instant.getTime())
        expect(period.end.getTime()).toBeGreaterThan(instant.getTime())
      }
    }
  })

  it('refuses a timezone it does not know instead of silently using UTC', () => {
    expect(() => monthPeriod(new Date(), 'Mars/Olympus_Mons')).toThrow(TimezoneError)
  })
})
