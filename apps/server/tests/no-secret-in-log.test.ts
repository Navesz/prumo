import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { REDACT_PATHS } from '../src/config.js'

/**
 * The test that has to exist because the failure it guards against is invisible.
 *
 * A provider's API key reaches this process in a request body, travels in a
 * request header, and comes back inside error messages written by thirteen
 * different companies. Any one of those paths can put it in a log file, where it
 * sits in plain text, gets shipped to a log aggregator, and survives every
 * rotation of the key itself.
 *
 * Nothing about that failure is visible: the application works, the tests pass,
 * and the key is in a file somebody else can read.
 */

const SECRET = `r8_${randomBytes(24).toString('hex')}`

/** Captures everything a pino logger writes, the way a log file would. */
async function capture(write: (log: import('pino').Logger) => void): Promise<string> {
  const { pino } = await import('pino')
  const sink = new PassThrough()
  const chunks: Buffer[] = []
  sink.on('data', (chunk: Buffer) => chunks.push(chunk))

  const logger = pino({ redact: { paths: [...REDACT_PATHS], censor: '[redacted]' } }, sink)
  write(logger)

  await new Promise((resolve) => setImmediate(resolve))
  return Buffer.concat(chunks).toString('utf8')
}

describe('a provider key must never reach a log', () => {
  it('redacts every header a key can arrive in', async () => {
    const output = await capture((log) => {
      log.info(
        {
          req: {
            headers: {
              // The five auth styles across the thirteen providers. fal sends
              // "Key", not "Bearer"; BFL uses x-key; Google uses x-goog-api-key;
              // Segmind uses x-api-key.
              authorization: `Key ${SECRET}`,
              'x-api-key': SECRET,
              'x-key': SECRET,
              'x-goog-api-key': SECRET,
              cookie: `prumo_sessao=${SECRET}`,
            },
          },
        },
        'incoming request',
      )
    })

    expect(output).not.toContain(SECRET)
    expect(output).toContain('[redacted]')
  })

  it('redacts the field names a secret travels under', async () => {
    const output = await capture((log) => {
      log.info({ apiKey: SECRET, api_key: SECRET, secret: SECRET, kek: SECRET, pepper: SECRET })
    })

    expect(output).not.toContain(SECRET)
  })

  it('redacts the prompt, which is free text a person wrote', async () => {
    // Not a key, and redacted anyway. A prompt can contain anything — including a
    // key somebody pasted into the wrong box — and it is the user's writing,
    // which does not belong in an operator's log by default.
    const output = await capture((log) => {
      log.info({ prompt: `generate a poster, my key is ${SECRET}` }, 'generation requested')
    })

    expect(output).not.toContain(SECRET)
  })

  it('covers every sensitive field at the root AND nested', async () => {
    // The bug this test found: pino's `*` matches EXACTLY ONE level, so a list of
    // `*.apiKey` alone protects `err.apiKey` and leaves a root-level `{ apiKey }`
    // in the clear. The configuration looked correct and protected nothing at the
    // level where these values actually get logged.
    for (const field of ['apiKey', 'api_key', 'kek', 'pepper', 'password', 'prompt', 'secret']) {
      const root = await capture((log) => log.info({ [field]: SECRET }))
      const nested = await capture((log) => log.info({ err: { [field]: SECRET } }))
      const deeper = await capture((log) => log.info({ req: { body: { [field]: SECRET } } }))

      expect(root, `root-level ${field}`).not.toContain(SECRET)
      expect(nested, `one level down: ${field}`).not.toContain(SECRET)
      expect(deeper, `two levels down: ${field}`).not.toContain(SECRET)
    }
  })

  it('does NOT cover four levels down, and that is written down rather than hoped', async () => {
    // pino has no recursive wildcard, so the list stops at two levels of nesting.
    // Making it longer would be guessing at shapes; the real defence is that a
    // secret is never put into an object that gets logged. This test states the
    // boundary so nobody discovers it in an incident.
    const output = await capture((log) => log.info({ a: { b: { c: { apiKey: SECRET } } } }))
    expect(output).toContain(SECRET)
  })

  it('names every path it protects, so removing one is a visible diff', () => {
    const paths = [...REDACT_PATHS]

    expect(paths).toContain('req.headers.authorization')
    expect(paths).toContain('req.headers["x-goog-api-key"]')
    expect(paths).toContain('res.headers["set-cookie"]')

    for (const field of ['apiKey', 'api_key', 'kek', 'pepper', 'password', 'prompt', 'secret']) {
      expect(paths, `${field} at the root`).toContain(field)
      expect(paths, `${field} one level down`).toContain(`*.${field}`)
      expect(paths, `${field} two levels down`).toContain(`*.*.${field}`)
    }
  })

  it('DOES leak when a provider echoes the key into a free-text message', async () => {
    // The honest half of this file. Redaction works on known paths, and a
    // provider that pastes part of the header it received into `error.message`
    // defeats it — the value arrives somewhere nobody declared.
    //
    // This test asserts the CURRENT behaviour rather than the desired one, so
    // that the day a sanitiser is added, this test fails and gets updated
    // deliberately. A gap that no test describes is a gap nobody remembers.
    const output = await capture((log) => {
      log.error({ err: { message: `provider rejected header: Key ${SECRET}` } }, 'call failed')
    })

    expect(output).toContain(SECRET)

    // The fix belongs in the provider adapter, before the error is ever handed to
    // the logger: sanitise the provider's message against the secret we just
    // sent. That lands with the generation adapters in M4, and this test changes
    // shape when it does.
  })
})
