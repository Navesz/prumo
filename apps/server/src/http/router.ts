import { implement } from '@orpc/server'
import { contract, type PublicUser } from '@prumo/contract'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Auth } from '../app/auth.js'
import type { Budgets } from '../app/budgets.js'
import type { Credentials } from '../app/credentials.js'
import { AppError } from '../app/errors.js'
import type {
  BudgetRecord,
  CredentialSummary,
  ProviderInfo,
  UserRecord,
  VerifyOutcome,
} from '../app/ports.js'
import { assertNonNegative, formatNano, parseNano } from '../domain/money.js'
import { latestMigrationName } from '../db/migrate.js'
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie.js'

export interface RouterContext {
  readonly request: FastifyRequest
  readonly reply: FastifyReply
  readonly auth: Auth
  readonly budgets: Budgets
  readonly credentials: Credentials
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
    period: budget.period,
    periodStart: budget.periodStart.toISOString(),
    periodEnd: budget.periodEnd.toISOString(),
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

  const budget = await context.budgets.setCap(context.user, input.period, capNano)
  return { budget: toPublicBudget(budget) }
})

// --- credentials ---------------------------------------------------------------

function toPublicCredential(c: CredentialSummary) {
  return {
    id: c.id,
    provider: c.provider,
    kind: c.kind,
    label: c.label,
    lastFour: c.lastFour,
    status: c.status,
    verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
    lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }
}

function toPublicProvider(p: ProviderInfo) {
  return {
    slug: p.slug,
    name: p.name,
    active: p.active,
    mode: p.mode,
    costInResponse: p.costInResponse,
    outputTtlSeconds: p.outputTtlSeconds,
    docUrl: p.docUrl,
    notice: p.notice,
  }
}

function toPublicVerification(outcome: VerifyOutcome) {
  return outcome.status === 'rate_limited' && outcome.retryAfterSeconds !== undefined
    ? { status: outcome.status, retryAfterSeconds: outcome.retryAfterSeconds }
    : { status: outcome.status }
}

const listProviders = os.credential.providers
  .use(authenticated)
  .handler(async ({ context, errors }) => {
    if (!context.user) throw errors.NOT_AUTHENTICATED()
    const providers = await context.credentials.listProviders(context.user)
    return { providers: providers.map(toPublicProvider) }
  })

const listCredentials = os.credential.list
  .use(authenticated)
  .handler(async ({ context, errors }) => {
    if (!context.user) throw errors.NOT_AUTHENTICATED()
    const credentials = await context.credentials.list(context.user)
    return { credentials: credentials.map(toPublicCredential) }
  })

const addCredential = os.credential.add
  .use(authenticated)
  .handler(async ({ input, context, errors }) => {
    if (!context.user) throw errors.NOT_AUTHENTICATED()
    const hints = clientHints(context)

    try {
      const result = await context.credentials.add(context.user, {
        commandId: input.commandId,
        provider: input.provider,
        secret: input.secret,
        label: input.label ?? null,
        ipHash: hints.ipHash,
      })

      return {
        credential: toPublicCredential(result.credential),
        verification: toPublicVerification(result.verification),
      }
    } catch (error) {
      // The secret is never in an AppError and never reaches a log line from
      // here. Only the code travels.
      if (error instanceof AppError) {
        if (error.code === 'UNKNOWN_PROVIDER') {
          throw errors.UNKNOWN_PROVIDER({ data: { provider: input.provider } })
        }
        if (error.code === 'PROVIDER_DISABLED') {
          throw errors.PROVIDER_DISABLED({ data: { provider: input.provider } })
        }
        if (error.code === 'CREDENTIAL_DUPLICATE') {
          throw errors.CREDENTIAL_DUPLICATE({ data: { provider: input.provider } })
        }
      }
      throw error
    }
  })

const verifyCredential = os.credential.verify
  .use(authenticated)
  .handler(async ({ input, context, errors }) => {
    if (!context.user) throw errors.NOT_AUTHENTICATED()

    try {
      const outcome = await context.credentials.verify(context.user, input.id)
      const all = await context.credentials.list(context.user)
      const found = all.find((c) => c.id === input.id)

      return {
        verification: toPublicVerification(outcome),
        credential: found ? toPublicCredential(found) : null,
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'CREDENTIAL_NOT_FOUND') {
        throw errors.CREDENTIAL_NOT_FOUND()
      }
      throw error
    }
  })

const revokeCredential = os.credential.revoke
  .use(authenticated)
  .handler(async ({ input, context, errors }) => {
    if (!context.user) throw errors.NOT_AUTHENTICATED()
    const hints = clientHints(context)

    try {
      await context.credentials.revoke(context.user, input.id, hints.ipHash)
      // Stated in the response shape, not only in the docs: this removed the key
      // from Prumo and did nothing at the provider.
      return { revoked: true as const, alsoRevokedAtProvider: false as const }
    } catch (error) {
      if (error instanceof AppError && error.code === 'CREDENTIAL_NOT_FOUND') {
        throw errors.CREDENTIAL_NOT_FOUND()
      }
      throw error
    }
  })

export const router = os.router({
  health: { live, ready },
  auth: { register, signIn, signOut, me },
  budget: { list: listBudgets, setCap },
  credential: {
    providers: listProviders,
    list: listCredentials,
    add: addCredential,
    verify: verifyCredential,
    revoke: revokeCredential,
  },
})

export type Router = typeof router
