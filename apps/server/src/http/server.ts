import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { onError } from '@orpc/server'
import { OpenAPIHandler } from '@orpc/openapi/fastify'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Auth } from '../app/auth.js'
import type { Budgets } from '../app/budgets.js'
import type { Credentials } from '../app/credentials.js'
import { REDACT_PATHS, type Config } from '../config.js'
import { router, type RouterContext } from './router.js'

export interface ServerDeps {
  readonly config: Config
  readonly auth: Auth
  readonly budgets: Budgets
  readonly credentials: Credentials
  readonly checkDatabase: () => Promise<boolean>
  readonly hashClientHint: (value: string) => Buffer
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config } = deps

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Redaction is not optional here. Two of these paths are the ones people
      // forget: a provider can echo part of the header it received back inside
      // its own error message, and a prompt is free text written by a person.
      redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(helmet, {
    // The SPA is same-origin with the API, so the default CSP can stay strict.
    contentSecurityPolicy: config.nodeEnv === 'production',
  })

  await app.register(cookie)

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // In-memory is CORRECT here, and only here: one process serves everything.
    // The moment PRUMO_PAPEL splits this across containers, this store has to
    // move — the Herz auth spec records that exact defect (a Map per process
    // behaving as a global limit).
    allowList: [],
  })

  // oRPC owns body parsing. Fastify pre-parsing the body would hand the handler
  // an already-consumed stream.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_request, _payload, done) => {
    done(null, undefined)
  })

  const handler = new OpenAPIHandler(router, {
    interceptors: [
      onError((error) => {
        app.log.error({ err: error }, 'unhandled error in an oRPC procedure')
      }),
    ],
  })

  app.all('/api/*', async (request, reply) => {
    const context: RouterContext = {
      request,
      reply,
      auth: deps.auth,
      budgets: deps.budgets,
      credentials: deps.credentials,
      role: config.role,
      secureCookies: config.nodeEnv === 'production',
      checkDatabase: deps.checkDatabase,
      hashClientHint: deps.hashClientHint,
    }

    const { matched } = await handler.handle(request, reply, { prefix: '/api', context })
    if (matched) return reply

    return reply.status(404).send({ error: 'Not found' })
  })

  // Liveness stays outside the oRPC handler on purpose: it must answer even if
  // the router itself is broken, and the container healthcheck depends on it.
  app.get('/saude/vivo', async () => ({ status: 'ok' }))

  await serveWebApp(app)

  return app
}

/**
 * Serving the built SPA from the same process is an architecture decision, not
 * an infrastructure convenience: it is what gives us a single origin, and a
 * single origin is what lets the session cookie be host-only.
 */
async function serveWebApp(app: FastifyInstance): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../../web/dist'),
    resolve(here, '../../../../apps/web/dist'),
  ]

  const root = candidates.find((path) => existsSync(join(path, 'index.html')))

  if (!root) {
    app.log.warn(
      'No built web app found. Run `npm run build --workspace @prumo/web`. The API still works.',
    )
    return
  }

  await app.register(fastifyStatic, { root, prefix: '/' })

  app.setNotFoundHandler((request, reply) => {
    // Anything that is not the API and not a file is a client-side route.
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' })
    }
    return reply.sendFile('index.html')
  })
}
