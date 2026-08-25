import * as z from 'zod'
import { nanoUsd } from './primitives.js'

/**
 * The error taxonomy IS the product experience.
 *
 * Matching on a provider's message string, across thirteen providers that each
 * word failure differently, is unsustainable. Every failure a user can see gets a
 * stable code and an explicit HTTP status, and the screen decides what to say from
 * the code alone.
 *
 * The one that matters most is CREDENTIAL_ACCOUNT_UNVERIFIED: OpenAI answers 403
 * for a perfectly VALID key when the organization has not completed identity
 * verification. Without a code of its own, Prumo would say "invalid key" and the
 * user would spend hours debugging the wrong thing.
 */
export const errors = {
  // --- authentication and account ---------------------------------------------

  NOT_AUTHENTICATED: {
    status: 401,
    message: 'Sign in to continue.',
  },
  REGISTRATION_CLOSED: {
    status: 403,
    message: 'This instance runs in personal mode and already has its owner.',
  },
  EMAIL_TAKEN: {
    status: 409,
    message: 'That e-mail already has an account.',
  },
  INVALID_CREDENTIALS: {
    status: 401,
    message: 'E-mail or password is wrong.',
  },

  // --- the user's provider key ------------------------------------------------

  CREDENTIAL_INVALID: {
    status: 401,
    message: 'The provider rejected this key.',
    data: z.object({ provider: z.string() }),
  },
  CREDENTIAL_NO_CREDIT: {
    status: 402,
    message: 'This provider account is out of credit.',
    data: z.object({ provider: z.string() }),
  },
  /**
   * A VALID key that the provider refuses until identity verification completes.
   * OpenAI returns 403 here, with a 90-day lock per identity document.
   */
  CREDENTIAL_ACCOUNT_UNVERIFIED: {
    status: 403,
    message: 'The key works, but the provider has not verified this account yet.',
    data: z.object({ provider: z.string(), instructionsUrl: z.url().optional() }),
  },

  UNKNOWN_PROVIDER: {
    status: 404,
    message: 'There is no provider by that name.',
    data: z.object({ provider: z.string() }),
  },
  PROVIDER_DISABLED: {
    status: 409,
    message: 'This provider is switched off in this instance.',
    data: z.object({ provider: z.string() }),
  },
  CREDENTIAL_DUPLICATE: {
    status: 409,
    message: 'That key is already stored for this provider.',
    data: z.object({ provider: z.string() }),
  },
  CREDENTIAL_NOT_FOUND: {
    status: 404,
    message: 'No such credential.',
  },

  // --- money ------------------------------------------------------------------

  BUDGET_MONTH_CAP: {
    status: 422,
    message: 'This run would cross the monthly spending cap.',
    data: z.object({ availableNanoUsd: nanoUsd, requestedNanoUsd: nanoUsd }),
  },
  BUDGET_DAY_CAP: {
    status: 422,
    message: 'This run would cross the daily spending cap.',
    data: z.object({ availableNanoUsd: nanoUsd, requestedNanoUsd: nanoUsd }),
  },
  /**
   * The request left, the read timed out, and the provider has no idempotency key.
   * Nobody knows whether it billed. Retrying here is how a bug becomes a double
   * charge, so this is a terminal state with a human reconciliation step.
   */
  BILLING_DOUBTFUL: {
    status: 409,
    message:
      'We could not confirm whether the provider charged for this. It needs a human decision.',
    data: z.object({ generationId: z.uuid() }),
  },

  // --- the provider -----------------------------------------------------------

  PROVIDER_RATE_LIMITED: {
    status: 429,
    message: 'The provider is rate limiting this account.',
    data: z.object({
      provider: z.string(),
      retryAfterSeconds: z.number().int().nonnegative().optional(),
    }),
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'The provider is not answering.',
    data: z.object({ provider: z.string() }),
  },
  CONTENT_REFUSED: {
    status: 422,
    message: 'The provider refused this prompt or the image it produced.',
    data: z.object({ provider: z.string() }),
  },
  MODEL_REMOVED: {
    status: 410,
    message: 'This model is no longer published by the provider.',
    data: z.object({ modelId: z.string() }),
  },
  QUEUE_FULL: {
    status: 429,
    message: 'Too much work in flight. Try again shortly.',
  },
} as const
