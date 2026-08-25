import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'
import type { Ids, PasswordHasher, SessionTokens } from '../app/ports.js'

/**
 * Written out rather than `promisify(scrypt)`: promisify picks the 3-argument
 * overload, which silently drops the options object — and the options object is
 * where the cost parameters live. A hash that quietly used the default N would
 * have looked identical and been far weaker.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

/**
 * Password hashing: scrypt from `node:crypto`.
 *
 * Not argon2, and the reason is boring: argon2 is another native binary, and this
 * project already accepts one native dependency (sharp, for thumbnails). Two is a
 * self-host that fails at `npm install` on an architecture nobody tested.
 *
 * Parameters are stored INSIDE the hash string, so raising them later does not
 * invalidate existing passwords — verification reads the parameters it was
 * written with, and a rehash-on-login can upgrade them one account at a time.
 */
const SCRYPT_N = 131_072 // 2^17
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

// Node's default maxmem is 32 MiB, which is below what N=2^17 needs
// (128 * N * r = 128 MiB). Without this, hashing throws instead of being slow.
const SCRYPT_MAXMEM = 160 * 1024 * 1024

export function createPasswordHasher(): PasswordHasher {
  return {
    async hash(plain: string): Promise<string> {
      const salt = randomBytes(16)
      const derived = await scryptAsync(plain.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      })

      return [
        'scrypt',
        `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`,
        salt.toString('base64'),
        derived.toString('base64'),
      ].join('$')
    },

    async verify(plain: string, stored: string | null): Promise<boolean> {
      if (stored === null) {
        // An account with no password (OAuth only, later). Still burn comparable
        // time so "no password set" and "wrong password" are not distinguishable
        // by a stopwatch.
        await scryptAsync('', randomBytes(16), SCRYPT_KEYLEN, {
          N: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          maxmem: SCRYPT_MAXMEM,
        })
        return false
      }

      const parts = stored.split('$')
      if (parts.length !== 4 || parts[0] !== 'scrypt') return false

      const params = parseParams(parts[1] ?? '')
      if (!params) return false

      const salt = Buffer.from(parts[2] ?? '', 'base64')
      const expected = Buffer.from(parts[3] ?? '', 'base64')
      if (salt.length === 0 || expected.length === 0) return false

      const derived = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: SCRYPT_MAXMEM,
      })

      return derived.length === expected.length && timingSafeEqual(derived, expected)
    },
  }
}

function parseParams(raw: string): { N: number; r: number; p: number } | null {
  const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(raw)
  if (!match) return null

  const N = Number(match[1])
  const r = Number(match[2])
  const p = Number(match[3])

  // An attacker with write access to the database must not be able to lower the
  // cost by rewriting the stored string.
  if (N < 16_384 || r < 8 || p < 1 || N > 1_048_576) return null

  return { N, r, p }
}

/**
 * Session tokens.
 *
 * 32 bytes from a CSPRNG, handed to the browser once. Only the SHA-256 is stored,
 * so a SELECT on the sessions table is not enough to impersonate anybody. SHA-256
 * and not scrypt on purpose: the token is already high-entropy random, so the
 * slow hash would buy nothing and cost a full KDF on every single request.
 */
export function createSessionTokens(): SessionTokens {
  const hash = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest()

  return {
    create() {
      const token = randomBytes(32).toString('base64url')
      return { token, hash: hash(token) }
    },
    hash,
  }
}

/**
 * UUID v7: 48-bit millisecond timestamp, then randomness.
 *
 * Time-ordered, so rows land next to each other in the index and keyset
 * pagination sorts the way a person expects without a second column.
 */
export function createIds(now: () => number = Date.now): Ids {
  return {
    next(): string {
      const ms = BigInt(now())
      const bytes = randomBytes(16)

      bytes[0] = Number((ms >> 40n) & 0xffn)
      bytes[1] = Number((ms >> 32n) & 0xffn)
      bytes[2] = Number((ms >> 24n) & 0xffn)
      bytes[3] = Number((ms >> 16n) & 0xffn)
      bytes[4] = Number((ms >> 8n) & 0xffn)
      bytes[5] = Number(ms & 0xffn)

      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70 // version 7
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant 10

      const hex = bytes.toString('hex')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    },
  }
}

/** For tests and for anything that genuinely wants a v4. */
export const randomId = randomUUID

/**
 * Keyed hash for values we must be able to compare but must not be able to read
 * back: an IP address, a user agent, and later the fingerprint of a provider key.
 */
export function keyedHash(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}
