import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * The session cookie.
 *
 * Host-only (no `domain` attribute), HttpOnly, SameSite=Lax, and Secure outside
 * development. Host-only is possible because the SPA is served by this same
 * Fastify process: one origin means no cross-site cookie, no CORS with
 * credentials, and no cross-origin SSE. Putting the front end on another host
 * would force SameSite=None, which is strictly worse for no gain.
 */
export const SESSION_COOKIE = 'prumo_sessao'

export interface CookieOptions {
  readonly secure: boolean
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  const raw = request.cookies[SESSION_COOKIE]
  return raw === '' ? undefined : raw
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  options: CookieOptions,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply, options: CookieOptions): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
    path: '/',
  })
}
