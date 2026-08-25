import type { SealedSecret, Vault } from '../app/ports.js'
import { fingerprint, lastFour, open, rewrap, seal } from './envelope.js'

/**
 * The vault, behind an interface with plugs.
 *
 * `env` is the default and the only one implemented: the KEK is a 32-byte value
 * read from `PRUMO_KEK` at boot. OWASP advises against a key-encryption key in an
 * environment variable, and that advice is right — the answer here is not to
 * pretend otherwise but to make moving to a KMS a configuration change rather
 * than a migration, which is what the envelope structure and the `kekId` column
 * buy.
 *
 * `awskms` and `gcpkms` are the named next plugs. GCP KMS is about US$ 0.06 per
 * active key version per month against AWS's US$ 1, which makes it the cheaper
 * recommendation for anyone leaving `env`.
 */
export type { KekProvider, Vault } from '../app/ports.js'

export interface EnvVaultOptions {
  readonly kek: Buffer
  readonly pepper: Buffer
  /**
   * Identifies WHICH key sealed a row. `env:v1` today. Rotating means writing
   * rows under `env:v2` and rewrapping the `env:v1` ones — the partial index on
   * this column IS the work queue for that.
   */
  readonly kekId?: string
}

export function createEnvVault(options: EnvVaultOptions): Vault {
  const { kek, pepper } = options
  const kekId = options.kekId ?? 'env:v1'

  return {
    kekId,
    provider: 'env',

    seal(secret, parts) {
      return { ...seal(kek, secret, parts), kekId }
    },

    open(sealed, parts) {
      return open(kek, sealed, parts)
    },

    fingerprint(secret) {
      return fingerprint(pepper, secret)
    },

    lastFour,
  }
}

/**
 * Rewrap one row from an old KEK to a new one. The secret is never decrypted:
 * only the wrapped DEK changes.
 */
export function rewrapSealed(
  oldKek: Buffer,
  newKek: Buffer,
  newKekId: string,
  sealed: SealedSecret,
): SealedSecret {
  return { ...rewrap(oldKek, newKek, sealed), kekId: newKekId }
}

export type { AadParts, CredentialKind, SealedSecret } from '../app/ports.js'
export { ALGORITHM, VaultError } from './envelope.js'
