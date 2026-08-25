#!/usr/bin/env node
// Collects the price index from every provider that publishes one, and writes it.
//
// Runs as the database OWNER, on its own pool: `prumo_app` has SELECT on the
// catalogue and nothing else. In CI this runs on a schedule and opens a pull
// request when a price moves, so a change to what somebody pays is a diff a
// person reads — not a silent update.
//
// Every provider that publishes NOTHING machine-readable is reported by name at
// the end. Silence would read as "no prices exist".
import { falCollector } from '../apps/server/dist/collectors/fal.js'
import { openRouterCollector } from '../apps/server/dist/collectors/openrouter.js'
import { deepInfraCollector } from '../apps/server/dist/collectors/deepinfra.js'
import { createDb, createPool } from '../apps/server/dist/db/connection.js'
import { writeCatalog, catalogCounts } from '../apps/server/dist/db/catalog.js'

const url = process.env.DATABASE_URL
if (!url) {
  process.stderr.write('DATABASE_URL is required. See .env.example.\n')
  process.exit(78)
}

const pool = createPool({ connectionString: url, applicationName: 'prumo-collector', max: 2 })
const db = createDb(pool)

const COLLECTORS = [falCollector, openRouterCollector, deepInfraCollector]

// Named so the report can say what is missing rather than leaving a gap.
const NO_MACHINE_READABLE_PRICE = [
  'replicate',
  'runware',
  'bfl',
  'openai',
  'google',
  'kie',
  'wavespeed',
  'together',
  'novita',
  'segmind',
]

try {
  let total = 0

  for (const collector of COLLECTORS) {
    const result = await collector.collect()
    const written = await writeCatalog(db, result.models)
    total += written.pricesOpened

    process.stdout.write(
      `${collector.provider.padEnd(12)} ${String(result.models.length).padStart(4)} models · ` +
        `${String(written.pricesOpened).padStart(3)} new prices · ` +
        `${String(written.pricesClosed).padStart(3)} superseded · ` +
        `${String(written.unchanged).padStart(3)} unchanged · ` +
        `${String(result.skipped).padStart(4)} without a published price\n`,
    )

    for (const error of result.errors) {
      process.stderr.write(`  ! ${collector.provider}: ${error}\n`)
    }
  }

  const counts = await catalogCounts(db)
  process.stdout.write(`\ncatalogue: ${counts.models} models, ${counts.prices} current prices\n`)
  process.stdout.write(
    `no machine-readable price yet: ${NO_MACHINE_READABLE_PRICE.join(', ')}\n` +
      'Those arrive by hand, through a pull request carrying the source URL and the date.\n',
  )

  process.exit(total >= 0 ? 0 : 1)
} finally {
  await pool.end().catch(() => undefined)
}
