import { AppError } from './errors.js'
import type {
  Clock,
  CredentialSummary,
  CredentialVerifier,
  Ids,
  ProviderInfo,
  UserRecord,
  Vault,
  VerifyOutcome,
} from './ports.js'
import type { UnitOfWork } from './unit-of-work.js'

export interface CredentialDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: Ids
  readonly vault: Vault
  readonly verifier: CredentialVerifier
}

export interface AddedCredential {
  readonly credential: CredentialSummary
  readonly verification: VerifyOutcome
}

/**
 * `23505` é `unique_violation` no PostgreSQL, e é o único erro que significa
 * "essa chave já está aí". Comparar pelo código do driver, e não pela mensagem,
 * porque a mensagem muda com o idioma do servidor (`lc_messages`).
 */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23505'
  )
}

const fail = {
  unknownProvider: (slug: string) =>
    new AppError('UNKNOWN_PROVIDER', `No provider named ${slug}`, { provider: slug }),
  providerDisabled: (slug: string) =>
    new AppError('PROVIDER_DISABLED', undefined, { provider: slug }),
  duplicate: (slug: string) => new AppError('CREDENTIAL_DUPLICATE', undefined, { provider: slug }),
  notFound: () => new AppError('CREDENTIAL_NOT_FOUND'),
}

export function createCredentials(deps: CredentialDeps) {
  const { uow, clock, ids, vault, verifier } = deps

  function listProviders(user: UserRecord): Promise<ProviderInfo[]> {
    return uow.run({ kind: 'user', userId: user.id }, (repos) => repos.credentials.listProviders())
  }

  function list(user: UserRecord): Promise<CredentialSummary[]> {
    return uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.credentials.listForUser(user.id),
    )
  }

  /**
   * Store a key, then check it.
   *
   * The order matters and it is not the obvious one. Verifying first and storing
   * second would mean the secret exists only in memory across a network call
   * whose failure mode is a timeout — and on timeout the user is told nothing was
   * saved while, from the provider's side, a request carrying their key already
   * went out. Sealing first makes the record the source of truth and the check an
   * annotation on it.
   *
   * Sealing happens BEFORE the transaction opens, and the network call happens
   * AFTER it commits. No external I/O inside a transaction, ever: a transaction
   * that restarts re-runs its body, and re-running a provider call is the shape of
   * every double-charge in this system.
   */
  async function add(
    user: UserRecord,
    input: {
      commandId: string
      provider: string
      secret: string
      label: string | null
      ipHash: Buffer | null
    },
  ): Promise<AddedCredential> {
    const provider = await uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.credentials.findProvider(input.provider),
    )

    if (!provider) throw fail.unknownProvider(input.provider)
    if (!provider.active) throw fail.providerDisabled(input.provider)

    const secret = input.secret.trim()
    const id = ids.next()

    // The AAD is built from this row's identity. If somebody later moves the row
    // to another user_id, the tag stops verifying and the secret is unreadable —
    // which is the whole reason it is recalculated instead of stored.
    const sealed = vault.seal(secret, {
      id,
      userId: user.id,
      provider: provider.slug,
      kind: 'api_key',
    })

    const fingerprint = vault.fingerprint(secret)
    const lastFour = vault.lastFour(secret)

    const credential = await uow.run({ kind: 'user', userId: user.id }, async (repos) => {
      /*
       * O mesmo comando duas vezes é a MESMA resposta, não um erro.
       *
       * Isto respondia CREDENTIAL_DUPLICATE, que afirma um fato errado sobre a
       * chave da pessoa: um clique duplo ou um cliente que reenviou depois de um
       * timeout ouvia "você já adicionou essa chave" e parava de tentar. É a
       * mesma decisão que `auth.ts` já tomava para o registro.
       *
       * Reverificar não é efeito colateral — é leitura, não cobrança —, então o
       * caminho de verificação lá embaixo roda normalmente.
       */
      const replay = await repos.commands.find(input.commandId)
      if (replay) {
        const jaCriada = (replay.result as { credentialId?: string } | null)?.credentialId
        const existente = jaCriada
          ? (await repos.credentials.listForUser(user.id)).find((c) => c.id === jaCriada)
          : undefined

        if (existente) return existente
        // O comando rodou e a credencial que ele criou não está mais aqui —
        // revogada, provavelmente. Repetir o insert violaria a chave do comando.
        throw fail.notFound()
      }

      let created: CredentialSummary
      try {
        created = await repos.credentials.insert({
          id,
          userId: user.id,
          provider: provider.slug,
          kind: 'api_key',
          label: input.label,
          kekProvider: vault.provider,
          sealed,
          fingerprint,
          lastFour,
        })
      } catch (cause) {
        // The partial unique index on (user_id, provider, fingerprint) is what
        // actually decides, not a prior SELECT. Two simultaneous submissions of
        // the same key resolve here rather than racing.
        //
        // ONLY 23505. This used to catch everything and call it a duplicate, so a
        // serialization failure, a dropped connection or a constraint nobody
        // expected all reached the user as "you already added this key" — and
        // somebody who believes that does not retry, so the key is never stored.
        // It also hid the real cause from CI, which reported a duplicate for a
        // fresh user and a fresh key on a fresh database.
        if (!isUniqueViolation(cause)) throw cause
        throw new AppError('CREDENTIAL_DUPLICATE', undefined, { provider: provider.slug, cause })
      }

      await repos.credentials.recordEvent({
        credentialId: id,
        userId: user.id,
        provider: provider.slug,
        action: 'created',
        // `detail` is FORBIDDEN to carry a secret. Four characters and a label.
        detail: { lastFour, label: input.label },
        ipHash: input.ipHash,
      })

      await repos.commands.record({
        commandId: input.commandId,
        userId: user.id,
        route: 'credential.add',
        status: 200,
        result: { credentialId: id },
      })

      return created
    })

    // Outside the transaction, on purpose.
    //
    // `credential.id`, nunca o `id` gerado acima: num replay a transação devolve a
    // credencial que JÁ existia, com outro id, e anotar o id novo escreveria a
    // verificação numa linha que não existe — em silêncio, porque um UPDATE que
    // não acha nada não é erro.
    const verification = await verifier.verify({ provider: provider.slug, secret })
    const annotated = await applyVerification(
      user,
      credential.id,
      provider.slug,
      verification,
      input.ipHash,
    )

    return { credential: annotated ?? credential, verification }
  }

  async function verify(user: UserRecord, credentialId: string): Promise<VerifyOutcome> {
    const stored = await uow.run({ kind: 'user', userId: user.id }, (repos) =>
      repos.credentials.findById(user.id, credentialId),
    )

    if (!stored) throw fail.notFound()

    // Opened for the duration of one network call and never returned to a caller.
    // The only two places a plaintext secret exists in this system are here and
    // in the generation dispatcher.
    const secret = vault.open(stored.sealed, {
      id: stored.id,
      userId: stored.userId,
      provider: stored.provider,
      kind: stored.kind,
    })

    const outcome = await verifier.verify({ provider: stored.provider, secret })
    await applyVerification(user, stored.id, stored.provider, outcome, null)

    return outcome
  }

  async function applyVerification(
    user: UserRecord,
    credentialId: string,
    provider: string,
    outcome: VerifyOutcome,
    ipHash: Buffer | null,
  ): Promise<CredentialSummary | null> {
    const now = clock.now()

    return uow.run({ kind: 'user', userId: user.id }, async (repos) => {
      if (outcome.status === 'valid') {
        await repos.credentials.markVerified(credentialId, now)
        await repos.credentials.recordEvent({
          credentialId,
          userId: user.id,
          provider,
          action: 'verified',
          ipHash,
        })
      } else if (outcome.status === 'invalid') {
        const failures = await repos.credentials.recordAuthFailure(credentialId)
        await repos.credentials.recordEvent({
          credentialId,
          userId: user.id,
          provider,
          action: 'auth_failed',
          detail: { failures },
          ipHash,
        })
      }
      // Everything else — no_credit, unverified_account, rate_limited,
      // unavailable, no_probe — says nothing about whether the key is good, so
      // nothing is recorded against it. Marking a key invalid because the
      // provider was briefly down would be a lie the user then has to undo.

      const list = await repos.credentials.listForUser(user.id)
      return list.find((c) => c.id === credentialId) ?? null
    })
  }

  async function revoke(
    user: UserRecord,
    credentialId: string,
    ipHash: Buffer | null,
  ): Promise<void> {
    const now = clock.now()

    await uow.run({ kind: 'user', userId: user.id }, async (repos) => {
      const stored = await repos.credentials.findById(user.id, credentialId)
      if (!stored) throw fail.notFound()

      await repos.credentials.revoke(credentialId, now)
      await repos.credentials.recordEvent({
        credentialId,
        userId: user.id,
        provider: stored.provider,
        action: 'revoked',
        ipHash,
      })
    })

    // Revoking here does NOT revoke the key at the provider. The screen says so:
    // a key that leaked is used directly against the provider's API, where the
    // Prumo cap is irrelevant. Rotating it at the provider is the only real fix.
  }

  return { listProviders, list, add, verify, revoke }
}

export type Credentials = ReturnType<typeof createCredentials>
