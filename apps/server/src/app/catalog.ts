import { costPerImage, isFresh, REFERENCE_TARGET, type Target } from '../domain/pricing.js'
import type { CatalogRow } from './ports.js'
import type { UnitOfWork } from './unit-of-work.js'

export interface CatalogDeps {
  readonly uow: UnitOfWork
  readonly clock: { now(): Date }
}

export interface IndexEntry {
  readonly modelId: string
  readonly provider: string
  readonly providerName: string
  readonly name: string
  readonly family: string | null
  readonly tasks: readonly string[]
  readonly watermark: 'synthid' | 'none' | 'unknown'
  /** Cost of one image at the target, in nano-USD. Null when not comparable. */
  readonly costNano: bigint | null
  /** Why it is not comparable, or how the number was arrived at. Always shown. */
  readonly explanation: string
  readonly basis: string | null
  readonly source: string | null
  readonly collectedAt: Date | null
  readonly method: string | null
  /** False once the price is older than thirty days. It drops out of the ranking. */
  readonly fresh: boolean
  readonly note: string | null
}

export function createCatalog(deps: CatalogDeps) {
  const { uow, clock } = deps

  /**
   * The whole index, in one table, cheapest first.
   *
   * Open to anybody: no account, no key. Handing a service an API key is a
   * decision, and nobody should have to make it before seeing a single price.
   *
   * A model with no published price still appears, marked as such. Hiding those
   * would make the providers look more transparent than they are: fal lists 513
   * image models whose price is not in its catalogue payload at all.
   */
  async function index(target: Target = REFERENCE_TARGET): Promise<IndexEntry[]> {
    const now = clock.now()
    const rows = await uow.run({ kind: 'public' }, (repos) => repos.catalog.list())

    const entries = rows.map((row) => toEntry(row, target, now))

    // Cheapest first; everything not comparable falls to the bottom rather than
    // sorting as zero, which would put "unknown" at the top of a price list.
    return entries.sort((a, b) => {
      if (a.costNano === null && b.costNano === null) return a.name.localeCompare(b.name)
      if (a.costNano === null) return 1
      if (b.costNano === null) return -1
      return a.costNano < b.costNano ? -1 : a.costNano > b.costNano ? 1 : 0
    })
  }

  return { index }
}

function toEntry(row: CatalogRow, target: Target, now: Date): IndexEntry {
  if (!row.price) {
    return {
      modelId: row.modelId,
      provider: row.provider,
      providerName: row.providerName,
      name: row.name,
      family: row.family,
      tasks: row.tasks,
      watermark: row.watermark,
      costNano: null,
      explanation: 'this provider does not publish a price for this model',
      basis: null,
      source: null,
      collectedAt: null,
      method: null,
      fresh: false,
      note: null,
    }
  }

  const comparable = costPerImage(
    {
      basis: row.price.basis as never,
      unitNano: row.price.unitNano,
      tokensPerImage: row.price.tokensPerImage ?? undefined,
      formula: row.price.formula as never,
    },
    target,
  )

  return {
    modelId: row.modelId,
    provider: row.provider,
    providerName: row.providerName,
    name: row.name,
    family: row.family,
    tasks: row.tasks,
    watermark: row.watermark,
    costNano: comparable.comparable ? comparable.nano : null,
    explanation: comparable.comparable ? comparable.explanation : comparable.reason,
    basis: row.price.basis,
    source: row.price.source,
    collectedAt: row.price.collectedAt,
    method: row.price.method,
    fresh: isFresh(row.price.collectedAt, now),
    note: row.price.note,
  }
}

export type Catalog = ReturnType<typeof createCatalog>
