import { implement } from '@orpc/server'
import { contract, type PublicUser } from '@prumo/contract'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Auth } from '../app/auth.js'
import type { Budgets } from '../app/budgets.js'
import { AppError } from '../app/errors.js'
import type { BudgetRecord, UserRecord } from '../app/ports.js'
import { assertNonNegative, formatNano, parseNano } from '../domain/money.js'
import { latestMigrationName } from '../db/migrate.js'
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie.js'

export interface RouterContext {
  readonly request: FastifyRequest
  readonly reply: FastifyReply
  readonly auth: Auth
  readonly budgets: Budgets
  readonly role: 'api' | 'worker' | 'tudo'
  readonly secureCookies: boolean
  readonly checkDatabase: () => Promise<boolean>
  readonly hashClientHint: (value: string) => Buffer
}

const os = implement(contract).$context<RouterContext>()

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  }
}

function toPublicBudget(budget: BudgetRecord) {
  return {
    window: budget.window,
    windowStart: budget.windowStart.toISOString(),
    windowEnd: budget.windowEnd.toISOString(),
    capNanoUsd: formatNano(budget.capNano),
    reservedNanoUsd: formatNano(budget.reservedNano),
    spentNanoUsd: formatNano(budget.spentNano),
    exceededAt: budget.exceededAt ? budget.exceededAt.toISOString() : null,
    alertPercent: budget.alertPercent,
  }
}

function clientHints(context: RouterContext): { ipHash: Buffer | null; uaHash: Buffer | null } {
  // The IP and the user agent are stored as keyed hashes, never in the clear.
  // They exist to let somebody recognise their own sessions, not to build a
  // profile of them.
  const ip = context.request.ip
  const ua = context.request.headers['user-agent']

  return {
    ipHash: ip ? context.hashClientHint(ip) : null,
    uaHash: typeof ua === 'string' && ua.length > 0 ? context.hashClientHint(ua) : null,
  }
}

/** Every route that needs a signed-in caller goes through this, never a manual check. */
const authenticated = os.$context<RouterContext>().middleware(async ({ context, next }) => {
  const user = await context.auth.authenticate(readSessionToken(context.request))
  return next({ context: { ...context, user } })
})

// --- health -------------------------------------------------------------------

const live = os.health.live.handler(() => ({ status: 'ok' as const }))

const ready = os.health.ready.handler(async ({ context }) => {
  const database = await context.checkDatabase()
  return {
    status: database ? ('ok' as const) : ('degraded' as const),
    database,
    migration: latestMigrationName(),
    role: context.role,
  }
})

// --- auth ---------------------------------------------------------------------

const register = os.auth.register.handler(async ({ input, context, errors }) => {
  const hints = clientHints(context)

  try {
    const result = await context.auth.register({
      commandId: input.commandId,
      email: input.email,
      password: input.password,
      name: input.name,
      timezone: input.timezone,
      ipHash: hints.ipHash,
      uaHash: hints.uaHash,
    })

    setSessionCookie(context.reply, result.sessionToken, result.expiresAt, {
      secure: context.secureCookies,
    })

    return { user: toPublicUser(result.user) }
  } catch (error) {
    if (error instanceof AppError && error.code === 'REGISTRATION_CLOSED') {
      throw errors.REGISTRATION_CLOSED()
    }
    if (error instanceof AppError && error.code === 'EMAIL_TAKEN') {
      throw errors.EMAIL_TAKEN()
    }
    throw error
  }
})

const signIn = os.auth.signIn.handler(async ({ input, context, errors }) => {
  const hints = clientHints(context)

  try {
    const result = await context.auth.signIn({
      email: input.email,
      password: input.password,
      ipHash: hints.ipHash,
      uaHash: hints.uaHash,
    })

    setSessionCookie(context.reply, result.sessionToken, result.expiresAt, {
      secure: context.secureCookies,
    })

    return { user: toPublicUser(result.user) }
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_CREDENTIALS') {
      throw errors.INVALID_CREDENTIALS()
    }
    throw error
  }
})

const signOut = os.auth.signOut.handler(async ({ context }) => {
  await context.auth.signOut(readSessionToken(context.request))
  clearSessionCookie(context.reply, { secure: context.secureCookies })
  return { signedOut: true as const }
})

const me = os.auth.me.use(authenticated).handler(async ({ context }) => ({
  user: context.user ? toPublicUser(context.user) : null,
  registrationOpen: await context.auth.registrationOpen(),
}))

// --- budgets ------------------------------------------------------------------

const listBudgets = os.budget.list.use(authenticated).handler(async ({ context, errors }) => {
  if (!context.user) throw errors.NOT_AUTHENTICATED()

  const budgets = await context.budgets.list(context.user)
  return { budgets: budgets.map(toPublicBudget) }
})

const setCap = os.budget.setCap.use(authenticated).handler(async ({ input, context, errors }) => {
  if (!context.user) throw errors.NOT_AUTHENTICATED()

  // Through the domain parser, not BigInt() directly: it is what rejects a float,
  // an out-of-range amount and a negative cap with a message instead of a crash.
  const capNano = assertNonNegative(parseNano(input.capNanoUsd), 'A spending cap')

  const budget = await context.budgets.setCap(context.user, input.window, capNano)
  return { budget: toPublicBudget(budget) }
})

export const router = os.router({
  health: { live, ready },
  auth: { register, signIn, signOut, me },
  budget: { list: listBudgets, setCap },
})

export type Router = typeof router
