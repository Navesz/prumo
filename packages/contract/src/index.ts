import { oc } from '@orpc/contract'
import * as z from 'zod'
import { errors } from './errors.js'
import { budget, budgetPeriod, commandId, email, passwordSchema, publicUser } from './primitives.js'

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

export const contract = {
  health,
  auth,
  budget: budgets,
}

export type Contract = typeof contract

export const version = {
  /** Bumped by hand when the contract changes in a way clients must notice. */
  contract: '0.1.0',
  releasedAt: '2026-08-24' satisfies string,
} as const

export type { Budget, BudgetWindow, NanoUsd, PublicUser, UserRole } from './primitives.js'
