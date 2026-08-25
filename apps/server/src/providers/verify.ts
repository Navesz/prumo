import type { CredentialVerifier, VerifyOutcome } from '../app/ports.js'

/**
 * A cheap call that answers one question: does this key work?
 *
 * Everything here obeys the same three rules.
 *
 * **`fetch`, never a client that keeps the request around.** `axios` is banned
 * project-wide because its error object carries `config.headers`, and a
 * `console.error(err)` in a rare branch publishes a user's paid key into the log.
 *
 * **Every request has a timeout.** A hung call holds a worker slot, and later it
 * will hold a database lock and stall the queue behind it.
 *
 * **The secret never appears in a return value, a thrown error or a log line.**
 * The outcome is an enum. Some providers echo part of the header they received
 * back inside their own error message, so their response body is never forwarded.
 */

/** The destination of every outbound call is a CLOSED LIST here, never a column. */
interface Probe {
  readonly url: string
  readonly header: (secret: string) => Record<string, string>
  /**
   * For providers that answer HTTP 200 and put the real status in the body.
   * KIE.ai does exactly this: `{"code":401,"msg":"Unauthorized …"}` with a 200.
   * A probe that reads only the status code would call an invalid key valid.
   */
  readonly bodyStatus?: (body: unknown) => number | null
}

const PROBES: Readonly<Record<string, Probe>> = {
  replicate: {
    url: 'https://api.replicate.com/v1/account',
    header: (s) => ({ Authorization: `Bearer ${s}` }),
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    header: (s) => ({ Authorization: `Bearer ${s}` }),
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    // Header, not `?key=`. The query-string form works and must never be used:
    // it puts the user's secret into proxy logs and Referer headers.
    header: (s) => ({ 'x-goog-api-key': s }),
  },
  together: {
    url: 'https://api.together.xyz/v1/models',
    header: (s) => ({ Authorization: `Bearer ${s}` }),
  },
  deepinfra: {
    // `/v1/openai/models` answers 200 WITHOUT a key, so it proves nothing. This
    // one authenticates.
    url: 'https://api.deepinfra.com/v1/me',
    header: (s) => ({ Authorization: `Bearer ${s}` }),
  },
  wavespeed: {
    url: 'https://api.wavespeed.ai/api/v3/balance',
    header: (s) => ({ Authorization: `Bearer ${s}` }),
  },
  kie: {
    url: 'https://api.kie.ai/api/v1/chat/credit',
    header: (s) => ({ Authorization: `Bearer ${s}`, 'Content-Type': 'application/json' }),
    bodyStatus: (body) =>
      typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'number'
        ? body.code
        : null,
  },
}

/**
 * Six providers have no probe here yet: fal, BFL, Runware, Novita, Segmind and
 * Fireworks. Not an oversight — none of them exposes a documented, free, GET-able
 * endpoint that authenticates. fal's `api.fal.ai/v1/models` and KIE's catalogue
 * both answer 200 without a key, which makes them worse than useless as a check.
 *
 * The honest outcome for those is `no_probe`: the key is stored, `verified_at`
 * stays null, and the screen says it could not be checked rather than implying it
 * was. Inventing an endpoint would produce a green tick that means nothing.
 *
 * They gain a real check in M4, when their generation adapters are written and a
 * cheap call is a by-product rather than a guess.
 */
export const PROVIDERS_WITHOUT_PROBE = ['fal', 'bfl', 'runware', 'novita', 'segmind', 'fireworks']

export interface HttpVerifierOptions {
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof globalThis.fetch
}

export function createHttpVerifier(options: HttpVerifierOptions = {}): CredentialVerifier {
  const timeoutMs = options.timeoutMs ?? 10_000
  const doFetch = options.fetchImpl ?? globalThis.fetch

  return {
    async verify({ provider, secret }): Promise<VerifyOutcome> {
      const probe = PROBES[provider]
      if (!probe) return { status: 'no_probe' }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await doFetch(probe.url, {
          method: 'GET',
          headers: {
            ...probe.header(secret),
            // Never blank. Together's CDN answers 403 to a request without one,
            // and a probe that trips over that would report a working key as bad.
            'User-Agent': 'prumo/0.1 (+https://github.com/Navesz/prumo)',
          },
          signal: controller.signal,
        })

        let status = response.status

        if (probe.bodyStatus) {
          const body: unknown = await response.json().catch(() => null)
          const fromBody = probe.bodyStatus(body)
          if (fromBody !== null) status = fromBody
        }

        return classify(status, response.headers.get('retry-after'))
      } catch (error) {
        // No response body, no provider message, nothing that could carry an echo
        // of the header we just sent.
        if (error instanceof Error && error.name === 'AbortError') {
          return { status: 'unavailable' }
        }
        return { status: 'unavailable' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function classify(status: number, retryAfter: string | null): VerifyOutcome {
  if (status >= 200 && status < 300) return { status: 'valid' }

  switch (status) {
    case 401:
      return { status: 'invalid' }
    case 402:
      return { status: 'no_credit' }
    case 403:
      // A VALID key that the provider refuses until identity verification
      // completes. OpenAI answers 403 for exactly this, and without a code of its
      // own Prumo would say "invalid key" and send the user to debug the wrong
      // thing for hours.
      return { status: 'unverified_account' }
    case 429: {
      // `exactOptionalPropertyTypes` is on, so an absent value is an absent KEY,
      // never a present key holding `undefined`. The distinction matters the
      // moment this crosses a JSON boundary.
      const seconds = retryAfter === null ? Number.NaN : Number.parseInt(retryAfter, 10)
      return Number.isFinite(seconds)
        ? { status: 'rate_limited', retryAfterSeconds: seconds }
        : { status: 'rate_limited' }
    }
    default:
      return { status: 'unavailable' }
  }
}

/**
 * The verifier used in tests, and the reason there is an interface at all.
 *
 * A test that calls a provider for real is not a test, it is an expense — and
 * somebody eventually wires it into CI with a real key and finds out at the end
 * of the month.
 */
export function createFakeVerifier(
  outcomes: Readonly<Record<string, VerifyOutcome>>,
): CredentialVerifier {
  return {
    verify: ({ provider }) => Promise.resolve(outcomes[provider] ?? { status: 'no_probe' }),
  }
}
