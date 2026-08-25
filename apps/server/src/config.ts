import * as z from 'zod'

/**
 * Configuration is validated once, at boot, and the process REFUSES TO START when
 * something required is missing or malformed — naming exactly what.
 *
 * A server that boots with a broken config fails later, in production, on the
 * path that happens to touch the missing value. Here that path holds somebody's
 * paid API key, so "later" is not acceptable.
 */

const base64Key32 = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, 'base64').length === 32
    } catch {
      return false
    }
  },
  {
    message:
      "must be exactly 32 bytes encoded as base64 — generate with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"",
  },
)

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'is required'),

  /**
   * Losing this is irreversible: every stored provider key becomes unreadable.
   * It is validated for shape here, never logged, and never leaves this module.
   */
  PRUMO_KEK: base64Key32,

  /** Pepper for the key fingerprint HMAC. Losing it costs the duplicate check, not the keys. */
  PRUMO_PEPPER: base64Key32,

  PRUMO_PAPEL: z.enum(['api', 'worker', 'tudo']).default('tudo'),
  PRUMO_MODO: z.enum(['pessoal', 'publico']).default('pessoal'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  /**
   * Empty is a supported, common case: a self-host behind NAT. No webhook gets
   * registered and polling covers everything. No product path depends on it.
   */
  PRUMO_URL_PUBLICA: z.union([z.url(), z.literal('')]).default(''),

  PRUMO_ARMAZENAMENTO: z.enum(['disco', 's3']).default('disco'),
  PRUMO_DIR_BLOBS: z.string().default('./var/blobs'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Config = Readonly<{
  databaseUrl: string
  kek: Buffer
  pepper: Buffer
  role: 'api' | 'worker' | 'tudo'
  mode: 'pessoal' | 'publico'
  port: number
  host: string
  publicUrl: string | null
  storage: 'disco' | 's3'
  blobDir: string
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  nodeEnv: 'development' | 'test' | 'production'
  servesHttp: boolean
  runsWorker: boolean
}>

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)

  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)'
      return `  ${name} ${issue.message}`
    })
    throw new ConfigError(
      `Prumo cannot start. Fix the environment and try again:\n\n${lines.join('\n')}\n\nSee .env.example for what each one is for.\n`,
    )
  }

  const raw = parsed.data

  return Object.freeze({
    databaseUrl: raw.DATABASE_URL,
    kek: Buffer.from(raw.PRUMO_KEK, 'base64'),
    pepper: Buffer.from(raw.PRUMO_PEPPER, 'base64'),
    role: raw.PRUMO_PAPEL,
    mode: raw.PRUMO_MODO,
    port: raw.PORT,
    host: raw.HOST,
    publicUrl: raw.PRUMO_URL_PUBLICA === '' ? null : raw.PRUMO_URL_PUBLICA,
    storage: raw.PRUMO_ARMAZENAMENTO,
    blobDir: raw.PRUMO_DIR_BLOBS,
    logLevel: raw.LOG_LEVEL,
    nodeEnv: raw.NODE_ENV,
    servesHttp: raw.PRUMO_PAPEL !== 'worker',
    runsWorker: raw.PRUMO_PAPEL !== 'api',
  })
}

/**
 * Redaction list for the logger. Every one of these is a way a paid key reaches
 * a log file, and the last two are the ones people forget: a provider can echo
 * part of the header it received back inside its own error message, and a prompt
 * is free text written by a person.
 */
const SENSITIVE_FIELDS = ['apiKey', 'api_key', 'kek', 'pepper', 'password', 'prompt', 'secret']

/**
 * Every sensitive field, at the root and at two levels of nesting.
 *
 * The `*` wildcard in pino matches EXACTLY ONE level. A list of `*.apiKey` alone
 * therefore protects `err.apiKey` and leaves a root-level `{ apiKey }`
 * completely in the clear — which is what this configuration did until
 * `no-secret-in-log.test.ts` logged one and found it.
 *
 * Three levels cover the shapes that actually occur here: the root, one wrapper
 * (`err`, `req`, `body`), and two (`req.body`, `err.response`). Deeper than that
 * is NOT covered, and the answer is not a longer list — pino has no recursive
 * wildcard. The real defence is structural: a secret is never put into an object
 * that gets logged. Redaction is the net under that, not the floor.
 */
const atEveryDepth = SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`])

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-key"]',
  'req.headers["x-goog-api-key"]',
  'res.headers["set-cookie"]',
  ...atEveryDepth,
] as const
