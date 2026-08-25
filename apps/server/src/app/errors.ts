/**
 * Use cases throw these; the HTTP layer is the only place that knows they become
 * an ORPCError with a status. That way a use case stays testable without a
 * request, and the taxonomy stays in the contract where the client can see it.
 */
export class AppError<TCode extends string = string> extends Error {
  override readonly name = 'AppError'
  readonly code: TCode
  readonly data: Record<string, unknown> | undefined

  constructor(code: TCode, message?: string, data?: Record<string, unknown>) {
    super(message ?? code)
    this.code = code
    this.data = data
  }
}

export const fail = {
  notAuthenticated: () => new AppError('NOT_AUTHENTICATED'),
  registrationClosed: () => new AppError('REGISTRATION_CLOSED'),
  emailTaken: () => new AppError('EMAIL_TAKEN'),
  invalidCredentials: () => new AppError('INVALID_CREDENTIALS'),
  budgetCap: (period: 'month' | 'day', availableNano: bigint, requestedNano: bigint) =>
    new AppError(period === 'month' ? 'BUDGET_MONTH_CAP' : 'BUDGET_DAY_CAP', undefined, {
      availableNanoUsd: availableNano.toString(10),
      requestedNanoUsd: requestedNano.toString(10),
    }),
}
