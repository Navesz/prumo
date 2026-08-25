import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from '@prumo/contract'

/**
 * The typed client.
 *
 * It is built from the CONTRACT, not from the server implementation. A path, a
 * status or a schema that drifts on the server is a compile error here — which is
 * the entire reason the contract package exists.
 */
const link = new OpenAPILink(contract, {
  url: `${window.location.origin}/api`,
  // The session cookie is host-only, so the browser attaches it on its own. There
  // is no token in JavaScript to steal.
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'same-origin' }),
})

export const api: ContractRouterClient<typeof contract> = createORPCClient(link)

/**
 * Every mutation carries a client-generated idempotency key.
 *
 * If the server generated it, a retry from a phone on bad mobile data would
 * create a new command and duplicate the effect. Today that duplicates an
 * account; from M3 it duplicates a paid image.
 */
export function newCommandId(): string {
  return crypto.randomUUID()
}

/** Display only. The ledger stays in nano-USD; rounding happens at the screen. */
export function formatUsd(nanoUsd: string, fractionDigits = 2): string {
  const value = BigInt(nanoUsd)
  const negative = value < 0n
  const absolute = negative ? -value : value

  const whole = absolute / 1_000_000_000n
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, '0').slice(0, fractionDigits)

  return `${negative ? '-' : ''}US$ ${whole}.${fraction}`
}
