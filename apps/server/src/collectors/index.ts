import type { PriceBasis, PriceFormula } from '../domain/pricing.js'

/**
 * Where a price comes from.
 *
 * A collector fetches, parses and returns plain data. It never touches the
 * database and it never decides anything: a row it produces carries the source
 * URL and the moment it was read, and something else decides whether that is
 * fresh enough to route on.
 *
 * Three of the thirteen providers publish a machine-readable price. The rest are
 * a page a person has to read, and those rows arrive by hand through a pull
 * request with the source in it. That asymmetry is the honest state of this
 * problem, not a gap to paper over.
 */

export interface CollectedPrice {
  readonly basis: PriceBasis
  readonly unitNano: bigint
  readonly tokensPerImage?: number
  readonly formula?: PriceFormula
  readonly note?: string
}

export interface CollectedModel {
  readonly provider: string
  readonly endpointId: string
  readonly name: string
  readonly family?: string | undefined
  readonly tasks: readonly string[]
  readonly watermark: 'synthid' | 'none' | 'unknown'
  readonly license?: string | undefined
  readonly thumbnailUrl?: string | undefined
  readonly description?: string | undefined
  /** Null when the catalogue lists the model but publishes no price for it. */
  readonly price: CollectedPrice | null
  readonly source: string
  readonly collectedAt: Date
  readonly method: 'doc' | 'api' | 'measured' | 'estimated'
}

export interface CollectorResult {
  readonly provider: string
  readonly models: readonly CollectedModel[]
  /** Counted and reported rather than swallowed: silence would read as "no prices exist". */
  readonly skipped: number
  readonly errors: readonly string[]
}

export interface Collector {
  readonly provider: string
  collect(fetchImpl?: typeof globalThis.fetch): Promise<CollectorResult>
}

const USD_NANO = 1_000_000_000n

/** "$0.15" -> 150000000n. String in, integer out: no float ever touches a price. */
export function usdToNano(usd: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,9}))?$/.exec(usd.trim())
  if (!match) return null
  return BigInt(match[1] ?? '0') * USD_NANO + BigInt((match[2] ?? '').padEnd(9, '0'))
}

export async function getJson(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs = 20_000,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      // Never blank: Together's CDN answers 403 without one, and a collector that
      // trips over that reports "no prices" instead of "I was refused".
      headers: { 'User-Agent': 'prumo-catalog/0.1 (+https://github.com/Navesz/prumo)' },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
