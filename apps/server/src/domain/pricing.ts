/**
 * Turning thirteen different billing schemes into one comparable number.
 *
 * Without this the index is decoration: DeepInfra bills per megapixel scaled by
 * step count, Together bills one model per megapixel and another per image, BFL
 * charges for the first megapixel and adds the rest, and OpenAI and Google bill
 * per output TOKEN. Putting those in the same column without converting them is
 * how a comparison table becomes a lie with a nice layout.
 *
 * Pure: no clock, no I/O, no rounding of anything on its way into storage. The
 * comparable figure is computed for display and for routing, and the formula
 * that produced it stays visible next to it.
 */

export type PriceBasis =
  'per_image' | 'per_megapixel' | 'per_step' | 'per_second' | 'per_output_token' | 'formula'

export interface PriceRecord {
  readonly basis: PriceBasis
  /** Cost of one unit of `basis`, in nano-USD. */
  readonly unitNano: bigint
  /** Only for providers that bill per output token. Absent means not comparable. */
  readonly tokensPerImage?: number | undefined
  readonly formula?: PriceFormula | undefined
}

/**
 * A CLOSED shape with numeric parameters. Never an expression to interpret.
 *
 * `linear_in_megapixels_and_steps` is DeepInfra's actual scheme:
 * `base x (w/1024) x (h/1024) x (steps/refSteps)`.
 * `first_megapixel_then_rest` is how BFL prices FLUX.
 */
export type PriceFormula =
  | {
      readonly kind: 'linear_in_megapixels_and_steps'
      readonly baseNano: bigint
      readonly referenceSteps: number
    }
  | {
      readonly kind: 'first_megapixel_then_rest'
      readonly firstNano: bigint
      readonly perExtraMegapixelNano: bigint
    }
  | {
      readonly kind: 'multiplied_above_resolution'
      readonly baseNano: bigint
      readonly abovePixels: number
      readonly multiplier: number
    }

/** What a comparison is made against. 1024x1024 is the default reference. */
export interface Target {
  readonly width: number
  readonly height: number
  readonly steps: number
}

export const REFERENCE_TARGET: Target = { width: 1024, height: 1024, steps: 25 }

export type Comparable =
  | { readonly comparable: true; readonly nano: bigint; readonly explanation: string }
  | { readonly comparable: false; readonly reason: string }

const NANO_PER_MP = 1_048_576

/** Megapixels x 2^20, kept as an integer so no float touches a price. */
function pixelUnits(target: Target): number {
  return target.width * target.height
}

/**
 * The cost of ONE image at `target`, in nano-USD, or an honest refusal.
 *
 * Refusing is a real outcome and appears on screen as "not comparable". A number
 * we cannot defend is worse than a blank, because the router would act on it.
 */
export function costPerImage(price: PriceRecord, target: Target = REFERENCE_TARGET): Comparable {
  const pixels = pixelUnits(target)

  switch (price.basis) {
    case 'per_image':
      return {
        comparable: true,
        nano: price.unitNano,
        explanation: 'flat price per image',
      }

    case 'per_megapixel': {
      // Integer arithmetic throughout: multiply first, divide last.
      const nano = (price.unitNano * BigInt(pixels)) / BigInt(NANO_PER_MP)
      return {
        comparable: true,
        nano,
        explanation: `${target.width}x${target.height} is ${(pixels / NANO_PER_MP).toFixed(2)} MP, billed per megapixel`,
      }
    }

    case 'per_step': {
      const nano = price.unitNano * BigInt(target.steps)
      return {
        comparable: true,
        nano,
        explanation: `${target.steps} steps at the per-step price`,
      }
    }

    case 'per_output_token': {
      // OpenAI and Google bill images as output TOKENS. Without knowing how many
      // tokens one image costs, this number cannot be compared to a per-image
      // price — and inventing a token count would produce a confident wrong
      // ranking, which is the failure this whole column exists to avoid.
      if (price.tokensPerImage === undefined || price.tokensPerImage <= 0) {
        return {
          comparable: false,
          reason: 'billed per output token, and the tokens-per-image figure is not recorded yet',
        }
      }
      return {
        comparable: true,
        nano: price.unitNano * BigInt(price.tokensPerImage),
        explanation: `${price.tokensPerImage} output tokens per image`,
      }
    }

    case 'per_second':
      return {
        comparable: false,
        reason: 'billed per second of output, which is a video price, not an image price',
      }

    case 'formula': {
      if (!price.formula) {
        return { comparable: false, reason: 'declared as a formula but no formula was recorded' }
      }
      return evaluate(price.formula, target, pixels)
    }
  }
}

function evaluate(formula: PriceFormula, target: Target, pixels: number): Comparable {
  switch (formula.kind) {
    case 'linear_in_megapixels_and_steps': {
      const nano =
        (formula.baseNano * BigInt(pixels) * BigInt(target.steps)) /
        (BigInt(NANO_PER_MP) * BigInt(formula.referenceSteps))
      return {
        comparable: true,
        nano,
        explanation: `base x (${target.width}/1024) x (${target.height}/1024) x (${target.steps}/${formula.referenceSteps})`,
      }
    }

    case 'first_megapixel_then_rest': {
      const extra = Math.max(0, pixels - NANO_PER_MP)
      const nano =
        formula.firstNano + (formula.perExtraMegapixelNano * BigInt(extra)) / BigInt(NANO_PER_MP)
      return {
        comparable: true,
        nano,
        explanation: 'first megapixel at one rate, the rest at another',
      }
    }

    case 'multiplied_above_resolution': {
      const above = pixels > formula.abovePixels
      const nano = above
        ? (formula.baseNano * BigInt(Math.round(formula.multiplier * 1000))) / 1000n
        : formula.baseNano
      return {
        comparable: true,
        nano,
        explanation: above
          ? `above ${formula.abovePixels} pixels, charged ${formula.multiplier}x`
          : 'standard rate below the higher-resolution threshold',
      }
    }
  }
}

/** How stale a price may be before it stops being offered as "the cheapest route". */
export const MAX_PRICE_AGE_DAYS = 30

export function isFresh(collectedAt: Date, now: Date): boolean {
  const days = (now.getTime() - collectedAt.getTime()) / 86_400_000
  return days <= MAX_PRICE_AGE_DAYS
}
