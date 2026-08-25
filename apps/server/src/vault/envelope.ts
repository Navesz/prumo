import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import type { AadParts, CredentialKind, SealedSecret } from '../app/ports.js'

export type { AadParts, CredentialKind, SealedSecret }

/**
 * Envelope encryption for the one thing in this system that spends other people's
 * money.
 *
 * A random 32-byte DEK per credential encrypts the secret; the KEK encrypts the
 * DEK. The wrapped DEK can live next to the ciphertext, because neither is usable
 * without the KEK — and the KEK never goes into the database.
 *
 * What this protects against: a database dump, a leaked backup, a restored
 * replica, SQL injection. Those are the likely ones for a personal project.
 *
 * What it does NOT protect against: a compromised host. With code execution in
 * the Node process, the attacker reads `process.env.PRUMO_KEK` and the database is
 * on the same machine. That sentence belongs on the key-registration screen, not
 * only in this comment.
 */

export const ALGORITHM = 'AES-256-GCM' as const
const CIPHER = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const DEK_BYTES = 32
const AAD_VERSION = 1

export class VaultError extends Error {
  override readonly name = 'VaultError'
}

/**
 * The additional authenticated data, RECALCULATED from the row every time and
 * never stored.
 *
 * If the AAD were a column, somebody with write access to the database could move
 * a credential row to another `user_id` while keeping the old AAD, and the GCM tag
 * would still verify — one person's paid key would start generating on another
 * person's account. Recomputing it from the row's own identity makes that move
 * fail to decrypt.
 */
export function buildAad(parts: AadParts, version = AAD_VERSION): Buffer {
  return Buffer.from(
    `v${version}|${parts.id}|${parts.userId}|${parts.provider}|${parts.kind}`,
    'utf8',
  )
}

function assertKeyLength(key: Buffer, what: string): void {
  if (key.length !== 32) {
    throw new VaultError(`${what} must be 32 bytes, got ${key.length}`)
  }
}

function encrypt(
  key: Buffer,
  plaintext: Buffer,
  aad: Buffer | null,
): {
  nonce: Buffer
  ciphertext: Buffer
} {
  // A nonce is generated fresh for every single operation. Reusing one under the
  // same key in GCM does not merely leak the plaintext — it leaks the
  // authentication key, and every message under that key becomes forgeable.
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(CIPHER, key, nonce, { authTagLength: TAG_BYTES })
  if (aad) cipher.setAAD(aad)

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) }
}

function decrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer, aad: Buffer | null): Buffer {
  if (ciphertext.length < TAG_BYTES) {
    throw new VaultError('Ciphertext is shorter than the authentication tag')
  }

  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES)
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES)

  const decipher = createDecipheriv(CIPHER, key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tag)
  if (aad) decipher.setAAD(aad)

  try {
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch (cause) {
    // Deliberately vague. Distinguishing "wrong key" from "tampered row" from
    // "wrong AAD" hands an attacker a decryption oracle, and none of the three is
    // actionable for a legitimate caller anyway.
    throw new VaultError('Could not decrypt: wrong key, wrong context, or tampered data', { cause })
  }
}

export function seal(kek: Buffer, secret: string, parts: AadParts): SealedSecret {
  assertKeyLength(kek, 'KEK')
  if (secret.length === 0) throw new VaultError('Refusing to seal an empty secret')

  const dek = randomBytes(DEK_BYTES)
  const aad = buildAad(parts)

  try {
    const sealedSecret = encrypt(dek, Buffer.from(secret, 'utf8'), aad)
    const sealedDek = encrypt(kek, dek, null)

    return {
      kekId: '',
      algorithm: ALGORITHM,
      wrappedDek: sealedDek.ciphertext,
      dekNonce: sealedDek.nonce,
      secretCiphertext: sealedSecret.ciphertext,
      secretNonce: sealedSecret.nonce,
      aadVersion: AAD_VERSION,
    }
  } finally {
    // The DEK is gone from this process the moment it is wrapped. It cannot be
    // scrubbed from every copy the runtime may have made, but leaving the
    // original sitting in a live buffer is a choice, and this is not that choice.
    dek.fill(0)
  }
}

export function open(kek: Buffer, sealed: SealedSecret, parts: AadParts): string {
  assertKeyLength(kek, 'KEK')

  // The stored algorithm NEVER selects the decryptor. It is compared against a
  // constant, and a mismatch fails. Letting a column choose the algorithm is how
  // an attacker with database write access downgrades the cipher — the same shape
  // as a JWT library that honours the `alg` header.
  if (sealed.algorithm !== ALGORITHM) {
    throw new VaultError(`Unsupported algorithm on this row: ${String(sealed.algorithm)}`)
  }

  const dek = decrypt(kek, sealed.dekNonce, sealed.wrappedDek, null)

  try {
    assertKeyLength(dek, 'unwrapped DEK')
    const aad = buildAad(parts, sealed.aadVersion)
    return decrypt(dek, sealed.secretNonce, sealed.secretCiphertext, aad).toString('utf8')
  } finally {
    dek.fill(0)
  }
}

/**
 * Re-wrap a credential under a new KEK without ever writing the secret anywhere.
 *
 * Written now, before it is needed. If the KEK leaks and there is no rewrap,
 * changing `PRUMO_KEK` accomplishes nothing: every existing DEK is still wrapped
 * under the old one. A recovery procedure invented during an incident is a
 * procedure nobody has tested.
 */
export function rewrap(oldKek: Buffer, newKek: Buffer, sealed: SealedSecret): SealedSecret {
  assertKeyLength(oldKek, 'old KEK')
  assertKeyLength(newKek, 'new KEK')

  const dek = decrypt(oldKek, sealed.dekNonce, sealed.wrappedDek, null)

  try {
    assertKeyLength(dek, 'unwrapped DEK')
    const rewrapped = encrypt(newKek, dek, null)

    // Only the envelope changes. The secret's own ciphertext and nonce are
    // untouched, so the plaintext never exists in this process at all.
    return {
      ...sealed,
      wrappedDek: rewrapped.ciphertext,
      dekNonce: rewrapped.nonce,
    }
  } finally {
    dek.fill(0)
  }
}

/**
 * A keyed hash of the secret, so two things become possible without decrypting
 * anything: telling that a key is already registered, and matching "this key was
 * revoked at the provider" against the rows that hold it.
 *
 * Keyed with a pepper, not a bare digest: an unkeyed hash of a credential is
 * offline-guessable for any provider whose key format is public.
 */
export function fingerprint(pepper: Buffer, secret: string): Buffer {
  assertKeyLength(pepper, 'pepper')
  return createHmac('sha256', pepper).update(secret, 'utf8').digest()
}

/** The last four characters, which is all any screen ever shows. */
export function lastFour(secret: string): string {
  return secret.slice(-4)
}
