import { sql, type Kysely } from 'kysely'

/**
 * OpenRouter, which migration 0003 left out.
 *
 * It is an aggregator like fal and KIE, and it is the only source in this project
 * that publishes an official, documented, NUMERIC price list — no prose to parse.
 * Leaving it out of the provider table meant the collector produced rows the
 * database refused with a foreign key violation, which is the correct failure and
 * a much better one than inventing a provider row on the fly.
 *
 * Its image prices are per output TOKEN, so they are not comparable to a
 * per-image price until somebody records tokens-per-image per model. The index
 * shows them as "not comparable" rather than ranking them wrongly.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO provider (slug, name, active, auth_style, mode, cost_in_response, doc_url, notice)
    VALUES (
      'openrouter',
      'OpenRouter',
      true,
      'bearer',
      'sync',
      'units',
      'https://openrouter.ai/docs',
      'Prices are published per output token, not per image, so they are not directly comparable until a tokens-per-image figure is recorded for each model.'
    )
    ON CONFLICT (slug) DO NOTHING
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM provider WHERE slug = 'openrouter'`.execute(db)
}
