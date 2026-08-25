import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createEnvVault, rewrapSealed, VaultError, type AadParts } from '../src/vault/index.js'
import { buildAad, open, seal } from '../src/vault/envelope.js'

const KEK = randomBytes(32)
const PEPPER = randomBytes(32)

const parts: AadParts = {
  id: '018f3a2b-0000-7000-8000-000000000001',
  userId: '018f3a2b-0000-7000-8000-0000000000aa',
  provider: 'fal',
  kind: 'api_key',
}

// Shaped like a real key so nothing passes because the value was obviously fake.
// It is not one, and never was.
const SECRET = 'fal-key-4f3a9c2e8b1d7a6f5e4c3b2a1908f7e6' // alicerce-segredo-ok: fixture sintetica

describe('the vault', () => {
  const vault = createEnvVault({ kek: KEK, pepper: PEPPER })

  it('round-trips a secret and stamps which key sealed it', () => {
    const sealed = vault.seal(SECRET, parts)

    expect(sealed.kekId).toBe('env:v1')
    expect(sealed.algorithm).toBe('AES-256-GCM')
    expect(vault.open(sealed, parts)).toBe(SECRET)
  })

  it('never puts the secret, or the plain DEK, into the stored row', () => {
    const sealed = vault.seal(SECRET, parts)
    const stored = Buffer.concat([
      sealed.secretCiphertext,
      sealed.secretNonce,
      sealed.wrappedDek,
      sealed.dekNonce,
    ]).toString('latin1')

    expect(stored).not.toContain(SECRET)
    expect(stored).not.toContain(SECRET.slice(0, 12))
  })

  it('produces a different ciphertext every time, for the same secret', () => {
    // A fresh nonce per operation. Reusing one under the same key in GCM does not
    // merely leak the plaintext — it leaks the authentication key, and every
    // message under that key becomes forgeable.
    const a = vault.seal(SECRET, parts)
    const b = vault.seal(SECRET, parts)

    expect(a.secretNonce.equals(b.secretNonce)).toBe(false)
    expect(a.secretCiphertext.equals(b.secretCiphertext)).toBe(false)
    expect(vault.open(a, parts)).toBe(vault.open(b, parts))
  })

  it('REFUSES a row moved to another user', () => {
    // The attack the recalculated AAD exists to stop. Somebody with write access
    // to the database moves a credential row to their own user_id. If the AAD
    // were a stored column, the old value would travel with the row and the GCM
    // tag would still verify — one person's paid key generating on another
    // person's account.
    const sealed = vault.seal(SECRET, parts)
    const moved: AadParts = { ...parts, userId: '018f3a2b-0000-7000-8000-0000000000bb' }

    expect(() => vault.open(sealed, moved)).toThrow(VaultError)
  })

  it('REFUSES a row moved to another provider, or relabelled', () => {
    const sealed = vault.seal(SECRET, parts)

    expect(() => vault.open(sealed, { ...parts, provider: 'openai' })).toThrow(VaultError)
    expect(() => vault.open(sealed, { ...parts, kind: 'webhook_secret' })).toThrow(VaultError)
    expect(() => vault.open(sealed, { ...parts, id: parts.userId })).toThrow(VaultError)
  })

  it('REFUSES a tampered ciphertext instead of returning garbage', () => {
    const sealed = vault.seal(SECRET, parts)
    const flipped = Buffer.from(sealed.secretCiphertext)
    flipped[0] = (flipped[0] ?? 0) ^ 0xff

    expect(() => vault.open({ ...sealed, secretCiphertext: flipped }, parts)).toThrow(VaultError)
  })

  it('REFUSES the wrong KEK', () => {
    const sealed = vault.seal(SECRET, parts)
    const other = createEnvVault({ kek: randomBytes(32), pepper: PEPPER })

    expect(() => other.open(sealed, parts)).toThrow(VaultError)
  })

  it('never lets the stored algorithm choose the decryptor', () => {
    // The same shape as a JWT library that honours the `alg` header. An attacker
    // with database write access must not be able to downgrade the cipher by
    // editing a column.
    const sealed = vault.seal(SECRET, parts)
    const downgraded = { ...sealed, algorithm: 'AES-128-CBC' as unknown as typeof sealed.algorithm }

    expect(() => vault.open(downgraded, parts)).toThrow(/Unsupported algorithm/)
  })

  it('refuses to seal an empty secret', () => {
    expect(() => vault.seal('', parts)).toThrow(VaultError)
  })

  it('refuses a key that is not 32 bytes, rather than padding it', () => {
    expect(() => seal(randomBytes(16), SECRET, parts)).toThrow(/32 bytes/)
    expect(() => open(randomBytes(31), vault.seal(SECRET, parts), parts)).toThrow(/32 bytes/)
  })

  it('fingerprints a secret without revealing it, and only under the pepper', () => {
    const print = vault.fingerprint(SECRET)

    expect(print).toHaveLength(32)
    expect(print.toString('latin1')).not.toContain(SECRET.slice(0, 8))
    expect(vault.fingerprint(SECRET).equals(print)).toBe(true)
    expect(vault.fingerprint(`${SECRET}x`).equals(print)).toBe(false)

    const otherPepper = createEnvVault({ kek: KEK, pepper: randomBytes(32) })
    expect(otherPepper.fingerprint(SECRET).equals(print)).toBe(false)
  })

  it('shows four characters and no more', () => {
    expect(vault.lastFour(SECRET)).toBe(SECRET.slice(-4))
    expect(vault.lastFour(SECRET)).toHaveLength(4)
  })
})

describe('rewrap — written before it is needed', () => {
  it('moves a credential to a new KEK without decrypting the secret', () => {
    // If the KEK leaks and there is no rewrap, changing PRUMO_KEK accomplishes
    // nothing: every existing DEK is still wrapped under the old key. A recovery
    // procedure invented during an incident is a procedure nobody has tested.
    const oldKek = randomBytes(32)
    const newKek = randomBytes(32)

    const before = createEnvVault({ kek: oldKek, pepper: PEPPER })
    const after = createEnvVault({ kek: newKek, pepper: PEPPER, kekId: 'env:v2' })

    const sealed = before.seal(SECRET, parts)
    const rewrapped = rewrapSealed(oldKek, newKek, 'env:v2', sealed)

    expect(rewrapped.kekId).toBe('env:v2')
    expect(after.open(rewrapped, parts)).toBe(SECRET)

    // Only the envelope changed. The secret's own ciphertext is byte-identical,
    // which is what proves the plaintext never existed in the process.
    expect(rewrapped.secretCiphertext.equals(sealed.secretCiphertext)).toBe(true)
    expect(rewrapped.secretNonce.equals(sealed.secretNonce)).toBe(true)
    expect(rewrapped.wrappedDek.equals(sealed.wrappedDek)).toBe(false)

    // And the old key stops working on the rewrapped row.
    expect(() => before.open(rewrapped, parts)).toThrow(VaultError)
  })
})

describe('the additional authenticated data', () => {
  it('is a function of the row identity, and nothing else', () => {
    expect(buildAad(parts).toString('utf8')).toBe(
      `v1|${parts.id}|${parts.userId}|${parts.provider}|${parts.kind}`,
    )
  })

  it('changes when any part of that identity changes', () => {
    const base = buildAad(parts)
    const variants: AadParts[] = [
      { ...parts, id: 'x' },
      { ...parts, userId: 'x' },
      { ...parts, provider: 'x' },
      { ...parts, kind: 'oauth_refresh' },
    ]

    for (const variant of variants) {
      expect(buildAad(variant).equals(base)).toBe(false)
    }
  })
})
