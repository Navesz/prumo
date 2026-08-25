import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, REDACT_PATHS } from '../src/config.js'

const KEK = Buffer.alloc(32, 1).toString('base64')
const PEPPER = Buffer.alloc(32, 2).toString('base64')

const valid = {
  DATABASE_URL: 'postgres://localhost:5432/prumo',
  PRUMO_KEK: KEK,
  PRUMO_PEPPER: PEPPER,
}

describe('configuration', () => {
  it('refuses to start and NAMES the missing variable', () => {
    // The whole point of this test. A server that boots with a broken config
    // fails later, in production, on the path that happens to need the missing
    // value — and here that path holds somebody's paid API key.
    let message = ''
    try {
      loadConfig({ DATABASE_URL: valid.DATABASE_URL } as NodeJS.ProcessEnv)
    } catch (error) {
      message = error instanceof ConfigError ? error.message : String(error)
    }

    expect(message).toContain('PRUMO_KEK')
    expect(message).toContain('PRUMO_PEPPER')
    expect(message).toContain('cannot start')
  })

  it('refuses a KEK that is not exactly 32 bytes, and says how to make one', () => {
    const tooShort = Buffer.alloc(16, 1).toString('base64')

    expect(() => loadConfig({ ...valid, PRUMO_KEK: tooShort } as NodeJS.ProcessEnv)).toThrow(
      /32 bytes/,
    )
    expect(() =>
      loadConfig({ ...valid, PRUMO_KEK: 'not base64 at all !!' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError)
  })

  it('derives the role flags so a caller never re-implements the comparison', () => {
    expect(loadConfig({ ...valid } as NodeJS.ProcessEnv)).toMatchObject({
      role: 'tudo',
      servesHttp: true,
      runsWorker: true,
    })
    expect(loadConfig({ ...valid, PRUMO_PAPEL: 'api' } as NodeJS.ProcessEnv)).toMatchObject({
      servesHttp: true,
      runsWorker: false,
    })
    expect(loadConfig({ ...valid, PRUMO_PAPEL: 'worker' } as NodeJS.ProcessEnv)).toMatchObject({
      servesHttp: false,
      runsWorker: true,
    })
  })

  it('treats an empty public URL as the supported case, not as an error', () => {
    // A self-host behind NAT is the common case: no webhook is registered and
    // polling covers everything. No product path may depend on it.
    expect(
      loadConfig({ ...valid, PRUMO_URL_PUBLICA: '' } as NodeJS.ProcessEnv).publicUrl,
    ).toBeNull()
    expect(
      loadConfig({ ...valid, PRUMO_URL_PUBLICA: 'https://prumo.example' } as NodeJS.ProcessEnv)
        .publicUrl,
    ).toBe('https://prumo.example')
    expect(() =>
      loadConfig({ ...valid, PRUMO_URL_PUBLICA: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError)
  })

  it('closes registration by default', () => {
    // A public instance is opted into, never fallen into.
    expect(loadConfig({ ...valid } as NodeJS.ProcessEnv).mode).toBe('pessoal')
  })

  it('redacts every header a provider key can arrive in, plus the prompt', () => {
    const paths = [...REDACT_PATHS]

    for (const header of ['authorization', 'x-api-key', 'x-key', 'x-goog-api-key']) {
      expect(paths.some((path) => path.includes(header))).toBe(true)
    }

    // The prompt is free text written by a person and can contain anything.
    expect(paths).toContain('*.prompt')
    expect(paths).toContain('*.kek')
  })
})
