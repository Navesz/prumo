import type { Collector, CollectedModel, CollectedPrice, CollectorResult } from './index.js'
import { getJson, usdToNano } from './index.js'

/**
 * fal.ai publishes its catalogue, with prices, at an endpoint nobody documents.
 *
 * `GET fal.ai/api/models?categories=text-to-image` returns paginated models with
 * a `pricingInfoOverride` field written for humans:
 *
 *   "Your request will cost **$0.15** per image. For **$1.00**, you can run this
 *    model **7** times. 4K outputs will be charged at double the standard rate."
 *
 * So the price is real and current, and it arrives as prose. This file parses
 * that prose, and everything about that is fragile: it is an internal endpoint
 * that can change shape or vanish without notice, and the sentence has at least
 * four templates.
 *
 * Which is why every model that does not parse is COUNTED and reported instead of
 * quietly dropped. A collector that silently returns forty models out of a
 * hundred and ninety looks exactly like a collector that is working.
 */

const CATEGORIES = ['text-to-image', 'image-to-image'] as const
const BASE = 'https://fal.ai/api/models'

interface FalModel {
  id?: unknown
  title?: unknown
  category?: unknown
  shortDescription?: unknown
  thumbnailUrl?: unknown
  licenseType?: unknown
  modelFamily?: unknown
  pricingInfoOverride?: unknown
  billingMessage?: unknown
  hidePricing?: unknown
  deprecated?: unknown
  removed?: unknown
  tags?: unknown
}

export const falCollector: Collector = {
  provider: 'fal',

  async collect(fetchImpl = globalThis.fetch): Promise<CollectorResult> {
    const models: CollectedModel[] = []
    const errors: string[] = []
    const seen = new Set<string>()
    let skipped = 0

    for (const category of CATEGORIES) {
      // Pages are 1-BASED. Asking for page 0 returns an empty `items` array with
      // a perfectly healthy `pages: 5` next to it — so a loop starting at zero
      // silently loses one page per category and reports success.
      let page = 1
      let pages = 1

      while (page <= pages && page <= 20) {
        const url = `${BASE}?categories=${category}&page=${page}`

        let payload: unknown
        try {
          payload = await getJson(url, fetchImpl)
        } catch (error) {
          errors.push(
            `${category} page ${page}: ${error instanceof Error ? error.message : 'failed'}`,
          )
          break
        }

        const body = payload as { items?: unknown; pages?: unknown }
        pages = typeof body.pages === 'number' ? body.pages : 1
        const items = Array.isArray(body.items) ? (body.items as FalModel[]) : []

        for (const item of items) {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id || seen.has(id)) continue
          seen.add(id)

          if (item.deprecated === true || item.removed === true) continue

          const price = parsePricing(item)
          if (!price) skipped += 1

          models.push({
            provider: 'fal',
            endpointId: id,
            name: typeof item.title === 'string' ? item.title : id,
            family: typeof item.modelFamily === 'string' ? item.modelFamily : undefined,
            tasks: [category],
            // fal proxies Google's models, which watermark. The catalogue does
            // not say which, so the honest value is "unknown" rather than "none".
            watermark: 'unknown',
            license: typeof item.licenseType === 'string' ? item.licenseType : undefined,
            thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : undefined,
            description:
              typeof item.shortDescription === 'string' ? item.shortDescription : undefined,
            price,
            source: `https://fal.ai/models/${id}`,
            collectedAt: new Date(),
            method: 'api',
          })
        }

        page += 1
      }
    }

    return { provider: 'fal', models, skipped, errors }
  },
}

/**
 * The four shapes seen in the wild, in the order they are tried.
 *
 * Exported so a test can pin each one. When fal changes the wording, the test is
 * what tells you — not a silently emptier catalogue.
 */
export function parsePricing(item: {
  pricingInfoOverride?: unknown
  billingMessage?: unknown
  hidePricing?: unknown
}): CollectedPrice | null {
  if (item.hidePricing === true) return null

  const text = typeof item.pricingInfoOverride === 'string' ? item.pricingInfoOverride : ''
  const billing = typeof item.billingMessage === 'string' ? item.billingMessage : ''

  // "will cost **$0.15** per image"
  const perImage = /\$\s*\**\s*([\d.]+)\s*\**\s*per\s+image/i.exec(text)
  if (perImage?.[1]) {
    const nano = usdToNano(perImage[1])
    if (nano !== null) {
      const doubled = /4K[^.]*double/i.test(text)
      return {
        basis: 'per_image',
        unitNano: nano,
        ...(doubled ? { note: '4K output is charged at double this rate' } : {}),
      }
    }
  }

  // "$0.025 per megapixel"
  const perMegapixel = /\$\s*\**\s*([\d.]+)\s*\**\s*per\s+megapixel/i.exec(text)
  if (perMegapixel?.[1]) {
    const nano = usdToNano(perMegapixel[1])
    if (nano !== null) return { basis: 'per_megapixel', unitNano: nano }
  }

  // "For **$1.00**, you can run this model **7** times" — the inverse form, and
  // the only one available for some models.
  const perDollar = /\$\s*\**\s*([\d.]+)\s*\**\s*,?\s*you can run this model\s*\**\s*(\d+)/i.exec(
    text,
  )
  if (perDollar?.[1] && perDollar[2]) {
    const budget = usdToNano(perDollar[1])
    const runs = Number(perDollar[2])
    if (budget !== null && runs > 0) {
      return {
        basis: 'per_image',
        unitNano: budget / BigInt(runs),
        note: `derived from "${perDollar[1]} buys ${runs} runs", so it is rounded`,
      }
    }
  }

  // "will cost **$0.04** for the first megapixel of output plus **$0.02** per
  // extra megapixel" — BFL's scheme, proxied through fal.
  const firstThenRest =
    /\$\s*\**\s*([\d.]+)\s*\**\s*for the first megapixel[^$]*\$\s*\**\s*([\d.]+)\s*\**\s*per extra megapixel/i.exec(
      text,
    )
  if (firstThenRest?.[1] && firstThenRest[2]) {
    const first = usdToNano(firstThenRest[1])
    const extra = usdToNano(firstThenRest[2])
    if (first !== null && extra !== null) {
      return {
        basis: 'formula',
        unitNano: first,
        formula: {
          kind: 'first_megapixel_then_rest',
          firstNano: first,
          perExtraMegapixelNano: extra,
        },
      }
    }
  }

  // Token-priced models proxied from Google and OpenAI ("Image tokens (per 1M):
  // ... Output images"). Comparing those to a per-image price needs a
  // tokens-per-image figure that this payload does not carry, and inventing one
  // would produce a confident wrong ranking. Skipped, and counted as skipped.
  if (/image tokens/i.test(text)) return null

  // A per-megapixel billing note with NO NUMBER says how it is billed and not how
  // much. This is the common case for fal's own flagship models — flux/schnell,
  // flux/dev, flux-pro — whose price lives on the rendered model page and not in
  // this payload. Recording a basis without a price would be inventing one.
  if (/megapixel/i.test(billing)) return null

  return null
}
