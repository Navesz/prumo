import type { Collector, CollectedModel, CollectorResult } from './index.js'
import { getJson } from './index.js'

/**
 * OpenRouter publishes an official, documented, numeric price list.
 *
 * It is the only source in this set that needs no parsing of prose: `pricing`
 * carries real numbers, and image models carry `image_output` in USD per output
 * TOKEN.
 *
 * Per token, not per image — so these prices are NOT directly comparable to a
 * per-image price until somebody records how many tokens an image costs for each
 * model. Until then the index shows them as "not comparable" instead of a number
 * that ranks confidently and wrongly.
 */
const URL = 'https://openrouter.ai/api/v1/models'

interface OrModel {
  id?: unknown
  name?: unknown
  description?: unknown
  architecture?: { output_modalities?: unknown }
  pricing?: Record<string, unknown>
}

export const openRouterCollector: Collector = {
  provider: 'openrouter',

  async collect(fetchImpl = globalThis.fetch): Promise<CollectorResult> {
    const models: CollectedModel[] = []
    const errors: string[] = []
    let skipped = 0

    let payload: unknown
    try {
      payload = await getJson(URL, fetchImpl)
    } catch (error) {
      return {
        provider: 'openrouter',
        models: [],
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'failed'],
      }
    }

    const list = (payload as { data?: unknown }).data
    if (!Array.isArray(list)) {
      return { provider: 'openrouter', models: [], skipped: 0, errors: ['no data array'] }
    }

    for (const raw of list as OrModel[]) {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id) continue

      const outputs = raw.architecture?.output_modalities
      if (!Array.isArray(outputs) || !outputs.includes('image')) continue

      const perToken = raw.pricing?.['image_output']
      const asNumber = typeof perToken === 'string' ? Number(perToken) : Number.NaN

      if (!Number.isFinite(asNumber) || asNumber <= 0) {
        skipped += 1
        continue
      }

      // USD per token -> nano-USD per token, as an integer. These figures go to
      // nine decimal places, which is exactly what nano-USD was chosen for.
      const unitNano = BigInt(Math.round(asNumber * 1e9))

      models.push({
        provider: 'openrouter',
        endpointId: id,
        name: typeof raw.name === 'string' ? raw.name : id,
        family: id.split('/')[0],
        tasks: ['text-to-image'],
        // Google watermarks every image it generates with SynthID: invisible,
        // permanent, not optional. That changes what the output may be used for,
        // so it belongs on the card and not in a footnote.
        watermark: id.startsWith('google/') ? 'synthid' : 'unknown',
        description:
          typeof raw.description === 'string' ? raw.description.slice(0, 400) : undefined,
        price: { basis: 'per_output_token', unitNano },
        source: 'https://openrouter.ai/api/v1/models',
        collectedAt: new Date(),
        method: 'api',
      })
    }

    return { provider: 'openrouter', models, skipped, errors }
  },
}
