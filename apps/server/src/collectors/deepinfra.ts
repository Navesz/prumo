import type { Collector, CollectedModel, CollectedPrice, CollectorResult } from './index.js'
import { getJson, usdToNano } from './index.js'

/**
 * DeepInfra publishes its whole catalogue with a `pricing` object, unauthenticated.
 *
 * The price arrives as a short human string — "$0.0005 x (width/1024) x
 * (height/1024) x (iters/25)" or "$0.009 / image" — so this parser handles the
 * scaled form as a FORMULA rather than flattening it to a single number. Flattening
 * would be wrong at every resolution except the reference one, and wrong quietly.
 */
const URL = 'https://api.deepinfra.com/models/list'

interface DiModel {
  model_name?: unknown
  type?: unknown
  reported_type?: unknown
  description?: unknown
  cover_img_url?: unknown
  pricing?: {
    short?: unknown
    full?: unknown
    type?: unknown
    cents_per_image_unit?: unknown
    cents_per_sec?: unknown
  }
}

const IMAGE_TYPES = new Set(['text-to-image', 'inpainting', 'image-to-image'])

export const deepInfraCollector: Collector = {
  provider: 'deepinfra',

  async collect(fetchImpl = globalThis.fetch): Promise<CollectorResult> {
    let payload: unknown
    try {
      payload = await getJson(URL, fetchImpl)
    } catch (error) {
      return {
        provider: 'deepinfra',
        models: [],
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'failed'],
      }
    }

    if (!Array.isArray(payload)) {
      return { provider: 'deepinfra', models: [], skipped: 0, errors: ['not an array'] }
    }

    const models: CollectedModel[] = []
    let skipped = 0

    for (const raw of payload as DiModel[]) {
      const name = typeof raw.model_name === 'string' ? raw.model_name : null
      if (!name) continue

      const type = typeof raw.type === 'string' ? raw.type : ''
      if (!IMAGE_TYPES.has(type)) continue

      const price = parsePricing(raw.pricing ?? {})
      if (!price) skipped += 1

      models.push({
        provider: 'deepinfra',
        endpointId: name,
        name,
        family: name.split('/')[0],
        tasks: [type],
        watermark: 'unknown',
        thumbnailUrl: typeof raw.cover_img_url === 'string' ? raw.cover_img_url : undefined,
        description:
          typeof raw.description === 'string' ? raw.description.slice(0, 400) : undefined,
        price,
        source: `https://deepinfra.com/${name}`,
        collectedAt: new Date(),
        method: 'api',
      })
    }

    return { provider: 'deepinfra', models, skipped, errors: [] }
  },
}

/**
 * DeepInfra's price is STRUCTURED, not prose. `pricing.short` is null for every
 * image model; the real fields are `type` plus `cents_per_image_unit` or
 * `cents_per_sec`. Parsing the human string would have found nothing — and did,
 * on the first run, returning zero prices for fifty models without an error.
 *
 * Exported so a test pins each shape.
 */
export function parsePricing(pricing: {
  short?: unknown
  type?: unknown
  cents_per_image_unit?: unknown
  cents_per_sec?: unknown
}): CollectedPrice | null {
  if (pricing.type === 'image_units' && typeof pricing.cents_per_image_unit === 'number') {
    // Cents, so 3 means US$ 0.03. Straight to nano-USD as an integer.
    return {
      basis: 'per_image',
      unitNano: BigInt(Math.round(pricing.cents_per_image_unit * 1e7)),
      note: 'DeepInfra bills in "image units"; how a unit scales with resolution is not in this payload',
    }
  }

  // GPU seconds, not images. A per-second figure in a per-image column would be a
  // number that means something else entirely.
  if (pricing.type === 'time') return null

  const short = typeof pricing.short === 'string' ? pricing.short : ''
  if (short === '') return null

  // "$0.0005 x (width/1024) x (height/1024) x (iters/25)" — a formula, kept as one.
  const scaled = /\$\s*([\d.]+)\s*[x*×]\s*\(?\s*width\s*\/\s*1024/i.exec(short)
  if (scaled?.[1]) {
    const base = usdToNano(scaled[1])
    const iters = /iters?\s*\/\s*(\d+)/i.exec(short)
    if (base !== null) {
      return {
        basis: 'formula',
        unitNano: base,
        formula: {
          kind: 'linear_in_megapixels_and_steps',
          baseNano: base,
          referenceSteps: iters?.[1] ? Number(iters[1]) : 25,
        },
        note: short,
      }
    }
  }

  const perImage = /\$\s*([\d.]+)\s*\/\s*image/i.exec(short)
  if (perImage?.[1]) {
    const nano = usdToNano(perImage[1])
    if (nano !== null) return { basis: 'per_image', unitNano: nano }
  }

  const perMegapixel = /\$\s*([\d.]+)\s*\/\s*megapixel/i.exec(short)
  if (perMegapixel?.[1]) {
    const nano = usdToNano(perMegapixel[1])
    if (nano !== null) return { basis: 'per_megapixel', unitNano: nano }
  }

  // "$0.0025 / second (480p)" is a video price. Recording it as an image price
  // would put a number in a column where it means something else entirely.
  return null
}
