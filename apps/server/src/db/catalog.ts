import { sql } from 'kysely'
import type { CollectedModel } from '../collectors/index.js'
import type { Db } from './connection.js'

/**
 * Writing a collected price into the catalogue.
 *
 * Append-only: a price row is never edited. When the number changes, the current
 * row is CLOSED with `effective_to` and a new one opens. That is what turns the
 * table into a history instead of a claim about today — and it is why
 * `preco_snapshot` on a generation can point at a row that will still say, a year
 * from now, what the price was when the money was spent.
 *
 * Runs as the OWNER, on the migration pool. `prumo_app` has SELECT on these
 * tables and nothing else.
 */
/**
 * A formula carries nano-USD as bigint, and `JSON.stringify` refuses bigint
 * outright — so it has to become a decimal string on the way into jsonb and a
 * bigint again on the way out. Doing it here, at the database boundary, is what
 * keeps every layer above this file working in integers.
 */
function formulaToJson(formula: unknown): unknown {
  if (formula === null || formula === undefined) return null
  return JSON.parse(
    JSON.stringify(formula, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString(10) : value,
    ),
  )
}

/** The other half. Keys ending in `Nano` hold money and come back as bigint. */
export function formulaFromJson(stored: unknown): unknown {
  if (stored === null || stored === undefined) return null
  const source = stored as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    result[key] = key.endsWith('Nano') && typeof value === 'string' ? BigInt(value) : value
  }

  return result
}

export interface CatalogWriteResult {
  readonly models: number
  readonly pricesOpened: number
  readonly pricesClosed: number
  readonly unchanged: number
}

export async function writeCatalog(
  db: Db,
  collected: readonly CollectedModel[],
): Promise<CatalogWriteResult> {
  let models = 0
  let pricesOpened = 0
  let pricesClosed = 0
  let unchanged = 0

  for (const item of collected) {
    const id = `${item.provider}:${item.endpointId}`

    await db
      .insertInto('model')
      .values({
        id,
        provider: item.provider,
        endpoint_id: item.endpointId,
        name: item.name,
        family: item.family ?? null,
        tasks: item.tasks as string[],
        watermark: item.watermark,
        license: item.license ?? null,
        thumbnail_url: item.thumbnailUrl ?? null,
        description: item.description ?? null,
        last_seen_at: item.collectedAt,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: item.name,
          family: item.family ?? null,
          tasks: item.tasks as string[],
          watermark: item.watermark,
          license: item.license ?? null,
          thumbnail_url: item.thumbnailUrl ?? null,
          description: item.description ?? null,
          active: true,
          last_seen_at: item.collectedAt,
        }),
      )
      .execute()

    models += 1

    if (!item.price) continue

    const current = await db
      .selectFrom('price')
      .select(['id', 'basis', 'unit_nano', 'formula'])
      .where('model_id', '=', id)
      .where('effective_to', 'is', null)
      .executeTakeFirst()

    const same =
      current !== undefined &&
      current.basis === item.price.basis &&
      current.unit_nano === item.price.unitNano &&
      JSON.stringify(current.formula ?? null) === JSON.stringify(formulaToJson(item.price.formula))

    if (same) {
      // The number did not move. Only the freshness stamp does — otherwise every
      // collection would open a new row and the history would be noise.
      await db
        .updateTable('price')
        .set({ collected_at: item.collectedAt })
        .where('id', '=', current.id)
        .execute()
      unchanged += 1
      continue
    }

    if (current) {
      await db
        .updateTable('price')
        .set({ effective_to: item.collectedAt })
        .where('id', '=', current.id)
        .execute()
      pricesClosed += 1
    }

    await db
      .insertInto('price')
      .values({
        model_id: id,
        effective_from: item.collectedAt,
        basis: item.price.basis,
        unit_nano: item.price.unitNano,
        formula: formulaToJson(item.price.formula) as never,
        tokens_per_image: item.price.tokensPerImage ?? null,
        source: item.source,
        collected_at: item.collectedAt,
        method: item.method,
        note: item.price.note ?? null,
      })
      .execute()

    pricesOpened += 1
  }

  return { models, pricesOpened, pricesClosed, unchanged }
}

/**
 * Models a collector stopped reporting.
 *
 * Marked inactive rather than deleted: a generation from last month still points
 * at one, and "this model no longer exists" is a fact a user needs, not a row to
 * make disappear.
 */
export async function markMissing(db: Db, provider: string, seenAt: Date): Promise<number> {
  const result = await db
    .updateTable('model')
    .set({ active: false, discontinued_at: seenAt })
    .where('provider', '=', provider)
    .where('last_seen_at', '<', seenAt)
    .where('active', '=', true)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

/** Used by the collector script only; the app role cannot write here. */
export async function catalogCounts(db: Db): Promise<{ models: number; prices: number }> {
  const row = await sql<{ models: string; prices: string }>`
    SELECT (SELECT count(*) FROM model) AS models,
           (SELECT count(*) FROM price WHERE effective_to IS NULL) AS prices
  `.execute(db)

  return { models: Number(row.rows[0]?.models ?? 0), prices: Number(row.rows[0]?.prices ?? 0) }
}
