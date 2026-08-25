/**
 * Recognising that two providers are selling the same model.
 *
 * This is the product's reason to exist, and until now the screen could not show
 * it. fal calls it "FLUX.1 [schnell]"; DeepInfra calls it
 * "black-forest-labs/FLUX-1-schnell". Same weights, same output, different price
 * — and the table treated them as two unrelated rows, which is exactly the fact
 * the whole index was built to surface.
 *
 * Pure: no clock, no I/O, no network. A name goes in, an identity comes out.
 *
 * ## Why this is a table of rules and not a clever algorithm
 *
 * There is no derivable id across providers. A path at WaveSpeed, a bare string
 * at KIE, a versioned AIR at Runware, `owner/name` plus a hash at Replicate.
 * Fuzzy matching on names is worse than useless here: matching FLUX.1 [dev] to
 * FLUX.1 [schnell] would tell somebody they can pay US$ 0.0005 for a model that
 * actually costs US$ 0.009, and they would find out from their invoice.
 *
 * So: an explicit table, a conservative parser, and NO MATCH is a perfectly good
 * answer. A model that does not resolve keeps its own row, which is the current
 * behaviour and is never wrong.
 */

export interface ModelIdentity {
  /** Stable key for grouping. `flux.1-schnell`, `nano-banana-pro`. */
  readonly key: string
  /** What a person calls it. `FLUX.1 [schnell]`. */
  readonly label: string
  /** Who made the weights, when it is known. */
  readonly maker: string | null
  /** How the match was made, so the screen can be honest about confidence. */
  readonly matchedBy: 'known-family' | 'unresolved'
}

interface FamilyRule {
  readonly key: string
  readonly label: string
  readonly maker: string
  /**
   * Every variant is listed, and the ORDER MATTERS: the most specific pattern
   * first, because `flux.2 klein` must not be swallowed by `flux.2`.
   */
  readonly variants: ReadonlyArray<{
    readonly key: string
    readonly label: string
    readonly match: RegExp
  }>
}

/**
 * The families worth grouping, chosen from what the collectors actually return.
 *
 * THREE model variants currently carry a price from more than one provider:
 * FLUX.2 [klein] 4B, FLUX.2 [klein] 9B and FLUX.2 [pro]. Three is the honest
 * number and it used to read as twelve, which is the more interesting fact — the
 * other nine were rules matching names they did not explain, and each one put a
 * "×N mais caro" on the screen comparing two different models.
 *
 * It is thin for a reason worth stating: ten of the thirteen providers publish no
 * machine-readable price at all, so there is little to cross-reference yet. The
 * grouping gets valuable as those arrive by hand, and it gets valuable HONESTLY
 * only because the guard below refuses everything it cannot explain.
 */
const FAMILIES: readonly FamilyRule[] = [
  {
    key: 'flux',
    label: 'FLUX',
    maker: 'Black Forest Labs',
    variants: [
      // 4B e 9B são pesos diferentes com preços diferentes, e o grupo os juntava:
      // o fal vende o 4B a US$ 9 e o 9B a US$ 11 sob a mesma chave.
      {
        key: 'flux.2-klein-9b',
        label: 'FLUX.2 [klein] 9B',
        match: /flux[.\s-]*2.*klein.*9\s*b\b/i,
      },
      {
        key: 'flux.2-klein-4b',
        label: 'FLUX.2 [klein] 4B',
        match: /flux[.\s-]*2.*klein.*4\s*b\b/i,
      },
      { key: 'flux.2-klein', label: 'FLUX.2 [klein]', match: /flux[.\s-]*2.*klein/i },
      { key: 'flux.2-flex', label: 'FLUX.2 [flex]', match: /flux[.\s-]*2.*flex/i },
      { key: 'flux.2-pro', label: 'FLUX.2 [pro]', match: /flux[.\s-]*2.*pro/i },
      { key: 'flux.2-dev', label: 'FLUX.2 [dev]', match: /flux[.\s-]*2.*dev/i },
      { key: 'flux.2-max', label: 'FLUX.2 [max]', match: /flux[.\s-]*2.*max/i },
      { key: 'flux.2-flash', label: 'FLUX.2 [flash]', match: /flux[.\s-]*2.*flash/i },
      { key: 'flux.2-turbo', label: 'FLUX.2 [turbo]', match: /flux[.\s-]*2.*turbo/i },
      { key: 'flux.2-edit', label: 'FLUX.2 Edit', match: /flux[.\s-]*2.*edit/i },
      { key: 'flux.2', label: 'FLUX.2', match: /flux[.\s-]*2(?![\s.-]*\w)/i },
      { key: 'flux.1-kontext', label: 'FLUX.1 Kontext', match: /flux[.\s-]*1?.*kontext/i },
      { key: 'flux.1-schnell', label: 'FLUX.1 [schnell]', match: /flux[.\s-]*1?.*schnell/i },
      { key: 'flux.1-dev', label: 'FLUX.1 [dev]', match: /flux[.\s-]*1?.*dev/i },
      { key: 'flux.1-pro', label: 'FLUX.1 [pro]', match: /flux[.\s-]*1?[\s.-]*pro\b/i },
      { key: 'flux.1', label: 'FLUX.1', match: /flux[.\s-]*1(?![\s.-]*\w)/i },
    ],
  },
  {
    key: 'nano-banana',
    label: 'Nano Banana',
    maker: 'Google',
    variants: [
      { key: 'nano-banana-pro', label: 'Nano Banana Pro', match: /nano[\s-]*banana.*pro/i },
      { key: 'nano-banana-2', label: 'Nano Banana 2', match: /nano[\s-]*banana.*2/i },
      { key: 'nano-banana', label: 'Nano Banana', match: /nano[\s-]*banana/i },
    ],
  },
  {
    key: 'gemini-image',
    label: 'Gemini Image',
    maker: 'Google',
    variants: [
      {
        key: 'gemini-3-pro-image',
        label: 'Gemini 3 Pro Image',
        match: /gemini[\s-]*3.*pro.*image/i,
      },
      {
        key: 'gemini-3-flash-image',
        label: 'Gemini 3 Flash Image',
        match: /gemini[\s-]*3.*flash.*image/i,
      },
      { key: 'gemini-image', label: 'Gemini Image', match: /gemini.*image/i },
    ],
  },
  {
    key: 'qwen-image',
    label: 'Qwen-Image',
    maker: 'Alibaba',
    variants: [
      { key: 'qwen-image-edit', label: 'Qwen-Image Edit', match: /qwen[\s-]*image.*edit/i },
      { key: 'qwen-image', label: 'Qwen-Image', match: /qwen[\s-]*image/i },
    ],
  },
  {
    key: 'seedream',
    label: 'Seedream',
    maker: 'ByteDance',
    variants: [
      { key: 'seedream-4', label: 'Seedream 4', match: /seedream[\s-]*4/i },
      { key: 'seedream-3', label: 'Seedream 3', match: /seedream[\s-]*3/i },
      { key: 'seedream', label: 'Seedream', match: /seedream/i },
    ],
  },
  {
    key: 'ideogram',
    label: 'Ideogram',
    maker: 'Ideogram',
    variants: [
      { key: 'ideogram-v4', label: 'Ideogram V4', match: /ideogram.*v?4/i },
      { key: 'ideogram-v3', label: 'Ideogram V3', match: /ideogram.*v?3/i },
      { key: 'ideogram', label: 'Ideogram', match: /ideogram/i },
    ],
  },
  {
    key: 'sdxl',
    label: 'SDXL',
    maker: 'Stability AI',
    variants: [
      {
        key: 'sdxl-turbo',
        label: 'SDXL Turbo',
        match: /sdxl.*turbo|stable[\s-]*diffusion.*xl.*turbo/i,
      },
      { key: 'sdxl', label: 'SDXL', match: /sdxl|stable[\s-]*diffusion[\s-]*xl/i },
    ],
  },
  {
    key: 'gpt-image',
    label: 'GPT Image',
    maker: 'OpenAI',
    variants: [
      { key: 'gpt-image-2', label: 'GPT Image 2', match: /gpt[\s-]*image[\s-]*2/i },
      { key: 'gpt-image-1', label: 'GPT Image 1', match: /gpt[\s-]*image[\s-]*1?/i },
    ],
  },
  {
    key: 'recraft',
    label: 'Recraft',
    maker: 'Recraft',
    variants: [
      { key: 'recraft-v3', label: 'Recraft V3', match: /recraft.*v?3/i },
      { key: 'recraft', label: 'Recraft', match: /recraft/i },
    ],
  },
  {
    key: 'imagen',
    label: 'Imagen',
    maker: 'Google',
    variants: [
      { key: 'imagen-4', label: 'Imagen 4', match: /imagen[\s-]*4/i },
      { key: 'imagen', label: 'Imagen', match: /imagen/i },
    ],
  },
]

/**
 * Words that describe a TASK or a knob, not a model.
 *
 * Stripped before matching so "FLUX.2 [klein] 4B LoRA" and
 * "black-forest-labs/FLUX-2-dev" reach the same rule. Left in, they would split
 * one model into a handful of near-duplicate rows and hide the very comparison
 * this file exists to produce.
 *
 * `edit`, `lora`, `controlnet`, `redux` and `fill` are deliberately NOT in this
 * list, and a test enforces it. They look like task words and are not: each one
 * names a SEPARATE ENDPOINT with a SEPARATE PRICE. The screen caught it live —
 * with `lora` stripped, fal's "FLUX 2 Lora" at US$ 21 and DeepInfra's
 * "FLUX-2-max" at US$ 100 landed in one row and the table announced "o mais caro
 * custa 4,8×" about two models that are not the same thing. Where a family has a
 * real variant, it gets its own rule above the general one.
 */
const NOISE =
  /\b(text[\s-]?to[\s-]?image|image[\s-]?to[\s-]?image|t2i|i2i|txt2img|img2img|inpainting|outpainting|upscal\w*|api|endpoint|model|preview|latest|beta)\b/gi

/**
 * Palavras que, SOBRANDO depois do casamento, dizem "isto é outro modelo".
 *
 * A guarda que faltava, e a razão de ela existir é uma lista de mentiras que a
 * tela chegou a exibir com número e tudo:
 *
 * - `Qwen Image` (fal, US$ 20) e `Qwen-Image-Max` (DeepInfra, US$ 75) viraram uma
 *   linha só anunciando "3,8× mais caro". Max é outro modelo.
 * - `Flux 2 Pro` e `FLUX 2 Pro Outpaint` caíram na mesma chave — um roda a partir
 *   de um prompt, o outro exige uma imagem e uma máscara.
 * - `Ideogram V4` e `Ideogram V4 (LoRA)` são endpoints com preços próprios.
 *
 * Cada um desses era uma regra específica a mais na tabela, para sempre, uma por
 * palavra que um provedor inventasse. Isto é uma regra só, e ela erra para o lado
 * certo: sobrou algo que a regra não explica, o modelo fica sem identidade e
 * ganha a própria linha — que é o comportamento de hoje e nunca está errado.
 *
 * `nano` fica de fora de propósito: é metade do nome de Nano Banana.
 *
 * A guarda olha o NOME EXIBIDO, nunca o id do endpoint, e a diferença tem custo.
 * `fal-ai/flux-2/klein/4b/base/edit` é a rota imagem→imagem do klein 4B Base: o
 * `/edit` ali é caminho, não modelo. `Qwen/Qwen-Image-Edit` traz `Edit` no nome, e
 * ali é modelo. Olhando os dois juntos, "FLUX.2 [klein] 4B Base" perdia a
 * identidade por causa de um segmento de rota e a única comparação honesta que
 * existia entre fal e DeepInfra sumia da tela.
 */
const QUALIFIERS =
  /\b(max|plus|lite|mini|ultra|outpaint\w*|inpaint\w*|lora|controlnet|redux|fill|gallery|distill\w*|realism|hdr|reference|multi|edit)\b/i

export function identifyModel(rawName: string, endpointId?: string): ModelIdentity {
  // Both the display name and the endpoint id get a look. fal's title is
  // "V4.0q [fast]" for a model whose id is "fal-ai/ideogram/v4"; the name alone
  // is not enough to tell what it is.
  const limpar = (t: string): string =>
    t
      .replace(/^[a-z0-9.-]+:/i, '')
      .replace(NOISE, ' ')
      .replace(/[_/]/g, ' ')

  const haystack = limpar(`${rawName} ${endpointId ?? ''}`)
  const nome = limpar(rawName)

  for (const family of FAMILIES) {
    for (const variant of family.variants) {
      if (!variant.match.test(haystack)) continue

      // O que a regra NÃO explicou do nome exibido. Se sobrar um qualificador
      // ali, a regra casou com o nome errado e um preço de outro modelo entraria
      // nesta linha.
      if (QUALIFIERS.test(nome.replace(variant.match, ' '))) continue

      return {
        key: variant.key,
        label: variant.label,
        maker: family.maker,
        matchedBy: 'known-family',
      }
    }
  }

  // No match is a good answer. The model keeps its own identity and its own row,
  // which is exactly what the table does today and is never wrong. Guessing here
  // would tell somebody they can pay US$ 0.0005 for a model that costs US$ 0.009.
  return {
    key: `unresolved:${rawName.toLowerCase().trim()}`,
    label: rawName,
    maker: null,
    matchedBy: 'unresolved',
  }
}

/** Every family the table knows how to group, for a filter that offers real options. */
export function knownFamilies(): ReadonlyArray<{ key: string; label: string; maker: string }> {
  return FAMILIES.map((f) => ({ key: f.key, label: f.label, maker: f.maker }))
}
