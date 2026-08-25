import { oc } from '@orpc/contract'
import * as z from 'zod'
import { errors } from './errors.js'
import {
  budget,
  budgetPeriod,
  commandId,
  credential,
  email,
  passwordSchema,
  providerInfo,
  providerSecret,
  providerSlug,
  publicUser,
  verification,
} from './primitives.js'

export * from './primitives.js'
export { errors } from './errors.js'

/**
 * The contract.
 *
 * One object types the server and the client. A path, a status or a schema that
 * drifts on one side is a compile error on the other, not a runtime surprise
 * found through a screen.
 *
 * Response validation is enabled on the server, in production too — a type only
 * protects honest code, and a provider renaming a cost field would otherwise
 * reach the ledger as NaN with nothing red anywhere.
 */

const health = {
  /** Liveness: the process is up. Never touches the database. */
  live: oc
    .route({ method: 'GET', path: '/saude/vivo' })
    .output(z.object({ status: z.literal('ok') })),

  /** Readiness: the process can serve. Touches the database on purpose. */
  ready: oc.route({ method: 'GET', path: '/saude/pronto' }).output(
    z.object({
      status: z.enum(['ok', 'degraded']),
      database: z.boolean(),
      migration: z.string().describe('Name of the last applied migration'),
      role: z.enum(['api', 'worker', 'tudo']),
    }),
  ),
}

const auth = {
  register: oc
    .route({ method: 'POST', path: '/auth/register' })
    .errors({
      REGISTRATION_CLOSED: errors.REGISTRATION_CLOSED,
      EMAIL_TAKEN: errors.EMAIL_TAKEN,
    })
    .input(
      z.object({
        commandId,
        email,
        password: passwordSchema,
        name: z.string().max(120).optional(),
        timezone: z.string().max(64).default('America/Sao_Paulo'),
      }),
    )
    .output(z.object({ user: publicUser })),

  signIn: oc
    .route({ method: 'POST', path: '/auth/sign-in' })
    .errors({ INVALID_CREDENTIALS: errors.INVALID_CREDENTIALS })
    .input(z.object({ email, password: passwordSchema }))
    .output(z.object({ user: publicUser })),

  signOut: oc
    .route({ method: 'POST', path: '/auth/sign-out' })
    .output(z.object({ signedOut: z.literal(true) })),

  /** Whoever is holding the session cookie. Null when nobody is. */
  me: oc
    .route({ method: 'GET', path: '/auth/me' })
    .output(z.object({ user: publicUser.nullable(), registrationOpen: z.boolean() })),
}

const budgets = {
  /**
   * The caller's own budgets. There is no user id in the input, by design: the
   * scope comes from the session, so there is no parameter to tamper with.
   */
  list: oc
    .route({ method: 'GET', path: '/budgets' })
    .errors({ NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED })
    .output(z.object({ budgets: z.array(budget) })),

  setCap: oc
    .route({ method: 'PUT', path: '/budgets/{period}' })
    .errors({ NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED })
    .input(
      z.object({
        commandId,
        period: budgetPeriod,
        capNanoUsd: z.string().regex(/^(0|[1-9]\d{0,18})$/, 'A spending cap cannot be negative'),
      }),
    )
    .output(z.object({ budget })),
}

/**
 * The key vault.
 *
 * Note what is NOT here: any route that returns a secret. Not a reveal endpoint,
 * not a masked one, not an export. A read path is exactly what an authorization
 * bug turns into a mass leak, and an XSS in the front end would drain the vault
 * through the user's own session. The screen gets four characters.
 */
const credentials = {
  providers: oc
    .route({ method: 'GET', path: '/providers' })
    .errors({ NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED })
    .output(z.object({ providers: z.array(providerInfo) })),

  list: oc
    .route({ method: 'GET', path: '/credentials' })
    .errors({ NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED })
    .output(z.object({ credentials: z.array(credential) })),

  add: oc
    .route({ method: 'POST', path: '/credentials' })
    .errors({
      NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED,
      UNKNOWN_PROVIDER: errors.UNKNOWN_PROVIDER,
      PROVIDER_DISABLED: errors.PROVIDER_DISABLED,
      CREDENTIAL_DUPLICATE: errors.CREDENTIAL_DUPLICATE,
    })
    .input(
      z.object({
        commandId,
        provider: providerSlug,
        secret: providerSecret,
        label: z.string().max(80).optional(),
      }),
    )
    // The verification travels WITH the credential, because "stored" and
    // "works" are different facts and a screen that conflates them is lying on
    // behalf of six providers that cannot be probed at all.
    .output(z.object({ credential, verification })),

  verify: oc
    .route({ method: 'POST', path: '/credentials/{id}/verify' })
    .errors({
      NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED,
      CREDENTIAL_NOT_FOUND: errors.CREDENTIAL_NOT_FOUND,
    })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ verification, credential: credential.nullable() })),

  revoke: oc
    .route({ method: 'DELETE', path: '/credentials/{id}' })
    .errors({
      NOT_AUTHENTICATED: errors.NOT_AUTHENTICATED,
      CREDENTIAL_NOT_FOUND: errors.CREDENTIAL_NOT_FOUND,
    })
    .input(z.object({ commandId, id: z.uuid() }))
    // Revoking here does NOT revoke the key at the provider. The screen says so:
    // a leaked key is used directly against the provider's API, where any cap
    // Prumo enforces is irrelevant.
    .output(z.object({ revoked: z.literal(true), alsoRevokedAtProvider: z.literal(false) })),
}

export const contract = {
  health,
  auth,
  budget: budgets,
  credential: credentials,
}

export type Contract = typeof contract

export const version = {
  /** Bumped by hand when the contract changes in a way clients must notice. */
  contract: '0.1.0',
  releasedAt: '2026-08-24' satisfies string,
} as const

export type { Budget, BudgetWindow, NanoUsd, PublicUser, UserRole } from './primitives.js'
