import { describe, expect, it } from 'vitest'
import { identifyModel, knownFamilies } from '../src/domain/model-identity.js'

/**
 * The tests that decide whether the price comparison is trustworthy.
 *
 * A false match here is not a cosmetic bug: it tells somebody they can pay
 * US$ 0.0005 for a model that actually costs US$ 0.009, and they find out from
 * their invoice. So the bar is asymmetric — missing a match is fine, inventing
 * one is not.
 */

describe('recognising the same model across providers', () => {
  it('matches the pair the whole product exists to show', () => {
    // fal's title and DeepInfra's model_name for the same weights.
    const fal = identifyModel('FLUX.1 [schnell]', 'fal-ai/flux/schnell')
    const deepinfra = identifyModel('black-forest-labs/FLUX-1-schnell')

    expect(fal.key).toBe('flux.1-schnell')
    expect(deepinfra.key).toBe(fal.key)
    expect(fal.maker).toBe('Black Forest Labs')
  })

  it('matches FLUX.2, which is where the real cross-provider data is today', () => {
    expect(identifyModel('FLUX.2 [dev]').key).toBe('flux.2-dev')
    expect(identifyModel('black-forest-labs/FLUX-2-dev').key).toBe('flux.2-dev')
    expect(identifyModel('FLUX.2 [klein] 4B Base').key).toBe('flux.2-klein-4b')
  })

  it('does NOT confuse variants that cost different amounts', () => {
    // The failure that would matter. schnell is US$ 0.0005 on DeepInfra and dev
    // is US$ 0.009 — eighteen times more. Collapsing them would be a lie with a
    // price tag on it.
    const schnell = identifyModel('FLUX.1 [schnell]')
    const dev = identifyModel('FLUX.1 [dev]')
    const kontext = identifyModel('black-forest-labs/FLUX.1-Kontext-dev')

    expect(schnell.key).not.toBe(dev.key)
    expect(dev.key).not.toBe(kontext.key)
    expect(kontext.key).toBe('flux.1-kontext')
  })

  it('does not let a general rule swallow a more specific one', () => {
    // `flux.2` would match "FLUX.2 [klein]" too. Order in the rule table is what
    // stops that, and this is the test that fails if somebody reorders it.
    expect(identifyModel('FLUX.2 [klein] 9B').key).toBe('flux.2-klein-9b')
    expect(identifyModel('FLUX.2 [flex]').key).toBe('flux.2-flex')
    expect(identifyModel('FLUX.2 Pro').key).toBe('flux.2-pro')
  })

  it('strips the task from the name, because a task is not a model', () => {
    // fal lists the same weights under several endpoints. Left in, "Text to
    // Image" and "Image to Image" would split one model into rows that cannot be
    // compared to anything.
    const t2i = identifyModel('Ideogram V4.0 Text to Image', 'fal-ai/ideogram/v4')
    const i2i = identifyModel('Ideogram V4.0q Image to Image', 'fal-ai/ideogram/v4/image-to-image')

    expect(t2i.key).toBe('ideogram-v4')
    expect(i2i.key).toBe(t2i.key)
  })

  it('refuses the match when a qualifier is left over', () => {
    // A guarda que existe porque a tela chegou a exibir estas três mentiras com
    // número: fal `Qwen Image` US$ 20 contra DeepInfra `Qwen-Image-Max` US$ 75,
    // anunciado como "3,8× mais caro" sobre dois modelos diferentes.
    expect(identifyModel('Qwen Image').key).toBe('qwen-image')
    expect(identifyModel('Qwen/Qwen-Image-Max').matchedBy).toBe('unresolved')
    expect(identifyModel('FLUX 2 Pro Outpaint').matchedBy).toBe('unresolved')
    expect(identifyModel('Ideogram V4.0q Text to Image (LoRA)').matchedBy).toBe('unresolved')
  })

  it('does not let the guard reject a name the rule fully explains', () => {
    // A guarda olha só o que SOBRA depois do casamento. `edit` é qualificador e
    // ainda assim Qwen-Image Edit casa, porque a regra do edit consumiu a palavra.
    expect(identifyModel('Qwen-Image Edit').key).toBe('qwen-image-edit')
    expect(identifyModel('SDXL Turbo').key).toBe('sdxl-turbo')
    expect(identifyModel('FLUX.2 [klein] 4B Base').key).toBe('flux.2-klein-4b')
    expect(identifyModel('black-forest-labs/FLUX-2-klein-4b').key).toBe('flux.2-klein-4b')
  })

  it('separa as variantes de FLUX.2 que um coringa juntava', () => {
    // `/flux.*2/` engolia tudo: `FLUX 2 Lora` (fal, US$ 21) e `FLUX-2-max`
    // (DeepInfra, US$ 100) saíram na mesma linha dizendo "4,8× mais caro".
    const chaves = [
      identifyModel('black-forest-labs/FLUX-2-max').key,
      identifyModel('FLUX 2 Flash').key,
      identifyModel('FLUX 2 Turbo').key,
      identifyModel('FLUX 2 Lora Gallery Realism').key,
    ]

    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaves[0]).toBe('flux.2-max')
    expect(identifyModel('FLUX 2 Lora Gallery Realism').matchedBy).toBe('unresolved')
  })

  it('reads the endpoint id when the display name says nothing useful', () => {
    // fal titles some models "V4.0q [fast]", which identifies nothing on its own.
    const bare = identifyModel('V4.0q [fast]', 'fal-ai/ideogram/v4')
    expect(bare.key).toBe('ideogram-v4')
  })

  it('matches the other families that appear at more than one provider', () => {
    expect(identifyModel('Nano Banana Pro').key).toBe('nano-banana-pro')
    expect(identifyModel('google/nano-banana-2').key).toBe('nano-banana-2')
    expect(identifyModel('Qwen-Image Edit').key).toBe('qwen-image-edit')
    expect(identifyModel('Qwen/Qwen-Image').key).toBe('qwen-image')
    expect(identifyModel('stabilityai/sdxl-turbo').key).toBe('sdxl-turbo')
    expect(identifyModel('ByteDance/Seedream-4').key).toBe('seedream-4')
  })

  it('leaves an unknown model alone instead of guessing', () => {
    // No match is a good answer: the model keeps its own row, which is what the
    // table does today and is never wrong.
    const unknown = identifyModel('PrunaAI/p-image')

    expect(unknown.matchedBy).toBe('unresolved')
    expect(unknown.label).toBe('PrunaAI/p-image')
    expect(unknown.maker).toBeNull()

    // And two different unknowns never collapse into each other.
    expect(unknown.key).not.toBe(identifyModel('deepseek-ai/Janus-Pro-1B').key)
  })

  it('is stable: the same name always yields the same key', () => {
    for (const name of ['FLUX.1 [schnell]', 'PrunaAI/p-image', 'Recraft V3']) {
      expect(identifyModel(name).key).toBe(identifyModel(name).key)
    }
  })

  it('offers a filter list of real families, not of raw strings', () => {
    const families = knownFamilies()

    expect(families.length).toBeGreaterThan(5)
    expect(families.map((f) => f.key)).toContain('flux')
    expect(families.every((f) => f.label !== '' && f.maker !== '')).toBe(true)
  })
})
