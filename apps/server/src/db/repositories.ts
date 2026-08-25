import type { Transaction } from 'kysely'
import { formulaFromJson } from './catalog.js'
import type {
  BudgetRecord,
  BudgetsRepo,
  CommandsRepo,
  CatalogRepo,
  CredentialsRepo,
  CredentialSummary,
  NewUser,
  ProviderInfo,
  Repos,
  StoredCredential,
  SessionsRepo,
  UserRecord,
  UsersRepo,
} from '../app/ports.js'
import type { BudgetRow, Database, ProviderCredentialRow, ProviderRow, UserRow } from './schema.js'

/**
 * Repositories.
 *
 * Every query that touches user-owned data filters by owner in the WHERE clause.
 * Never "fetch then check": a check after the fact is a check somebody forgets,
 * and row level security is the second door, not the first.
 */
export function makeRepos(trx: Transaction<Database>): Repos {
  return {
    users: makeUsers(trx),
    sessions: makeSessions(trx),
    budgets: makeBudgets(trx),
    commands: makeCommands(trx),
    credentials: makeCredentials(trx),
    catalog: makeCatalog(trx),
  }
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    role: row.role,
    active: row.active,
    timezone: row.timezone,
    createdAt: row.created_at,
  }
}

function makeUsers(trx: Transaction<Database>): UsersRepo {
  return {
    async countAll() {
      const row = await trx
        .selectFrom('users')
        .select(({ fn }) => fn.countAll<string>().as('total'))
        .executeTakeFirst()
      return Number(row?.total ?? 0)
    },

    async findByEmail(email) {
      const row = await trx
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst()
      return row ? toUser(row) : null
    },

    async findById(id) {
      const row = await trx.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
      return row ? toUser(row) : null
    },

    async insert(user: NewUser) {
      const row = await trx
        .insertInto('users')
        .values({
          id: user.id,
          email: user.email,
          password_hash: user.passwordHash,
          name: user.name,
          role: user.role,
          timezone: user.timezone,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      return toUser(row)
    },
  }
}

function makeSessions(trx: Transaction<Database>): SessionsRepo {
  return {
    async insert(input) {
      await trx
        .insertInto('sessions')
        .values({
          id: input.id,
          user_id: input.userId,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          ip_hash: input.ipHash,
          ua_hash: input.uaHash,
        })
        .execute()
    },

    async findLiveByTokenHash(tokenHash, now) {
      const row = await trx
        .selectFrom('sessions')
        .select(['id', 'user_id', 'expires_at'])
        .where('token_hash', '=', tokenHash)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .executeTakeFirst()

      return row ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at } : null
    },

    async touch(id, now) {
      await trx.updateTable('sessions').set({ last_used_at: now }).where('id', '=', id).execute()
    },

    async revoke(id, now) {
      await trx.updateTable('sessions').set({ revoked_at: now }).where('id', '=', id).execute()
    },
  }
}

function toBudget(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    capNano: row.cap_nano,
    reservedNano: row.reserved_nano,
    spentNano: row.spent_nano,
    exceededAt: row.exceeded_at,
    alertPercent: row.alert_percent,
  }
}

function makeBudgets(trx: Transaction<Database>): BudgetsRepo {
  return {
    async listForUser(userId, now) {
      const rows = await trx
        .selectFrom('budgets')
        .selectAll()
        .where('user_id', '=', userId)
        .where('period_end', '>', now)
        .orderBy('period')
        .execute()
      return rows.map(toBudget)
    },

    async upsertCap(input) {
      const row = await trx
        .insertInto('budgets')
        .values({
          id: input.id,
          user_id: input.userId,
          period: input.period,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          cap_nano: input.capNano,
        })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'period', 'period_start'])
            .doUpdateSet({ cap_nano: input.capNano, updated_at: new Date() }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()
      return toBudget(row)
    },

    /**
     * The spending cap. The condition of the rule is the condition of the write.
     *
     * Zero rows affected means the cap was reached — there is no separate check
     * to race against. Do not "improve" this into a SELECT plus an UPDATE.
     */
    async reserve(input) {
      const updated = await trx
        .updateTable('budgets')
        .set((eb) => ({
          reserved_nano: eb('reserved_nano', '+', input.costNano),
          updated_at: new Date(),
        }))
        .where('user_id', '=', input.userId)
        .where('period', '=', input.period)
        .where('period_start', '=', input.periodStart)
        .where((eb) =>
          eb(
            eb('spent_nano', '+', eb.ref('reserved_nano')),
            '<=',
            eb('cap_nano', '-', input.costNano),
          ),
        )
        .returning(['cap_nano', 'spent_nano', 'reserved_nano'])
        .executeTakeFirst()

      if (updated) {
        return {
          reserved: true,
          remainingNano: updated.cap_nano - updated.spent_nano - updated.reserved_nano,
        }
      }

      const current = await trx
        .selectFrom('budgets')
        .select(['cap_nano', 'spent_nano', 'reserved_nano'])
        .where('user_id', '=', input.userId)
        .where('period', '=', input.period)
        .where('period_start', '=', input.periodStart)
        .executeTakeFirst()

      const available = current ? current.cap_nano - current.spent_nano - current.reserved_nano : 0n

      return { reserved: false, availableNano: available < 0n ? 0n : available }
    },
  }
}

function makeCommands(trx: Transaction<Database>): CommandsRepo {
  return {
    async find(commandId) {
      const row = await trx
        .selectFrom('processed_commands')
        .select(['status', 'result'])
        .where('command_id', '=', commandId)
        .executeTakeFirst()
      return row ? { status: row.status, result: row.result } : null
    },

    async record(input) {
      await trx
        .insertInto('processed_commands')
        .values({
          command_id: input.commandId,
          user_id: input.userId,
          route: input.route,
          status: input.status,
          result: input.result as never,
        })
        .execute()
    },
  }
}

// --- M2: the provider catalogue and the key vault -------------------------------

function toProvider(row: ProviderRow): ProviderInfo {
  return {
    slug: row.slug,
    name: row.name,
    active: row.active,
    mode: row.mode,
    costInResponse: row.cost_in_response,
    outputTtlSeconds: row.output_ttl_seconds,
    docUrl: row.doc_url,
    notice: row.notice,
  }
}

function toSummary(row: ProviderCredentialRow): CredentialSummary {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    label: row.label,
    lastFour: row.last_four,
    status: row.status,
    verifiedAt: row.verified_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }
}

function toStored(row: ProviderCredentialRow): StoredCredential {
  return {
    ...toSummary(row),
    userId: row.user_id,
    sealed: {
      kekId: row.kek_id,
      algorithm: row.algorithm,
      wrappedDek: row.wrapped_dek,
      dekNonce: row.dek_nonce,
      secretCiphertext: row.secret_ciphertext,
      secretNonce: row.secret_nonce,
      aadVersion: row.aad_version,
    },
  }
}

/**
 * The columns a screen is allowed to see. Written out rather than `selectAll()`
 * so that adding a column to the table never silently widens what a list
 * endpoint returns — and the columns left out here are the sealed bytes.
 */
const SUMMARY_COLUMNS = [
  'id',
  'provider',
  'kind',
  'label',
  'last_four',
  'status',
  'verified_at',
  'last_used_at',
  'created_at',
] as const

function makeCredentials(trx: Transaction<Database>): CredentialsRepo {
  return {
    async listProviders() {
      const rows = await trx.selectFrom('provider').selectAll().orderBy('name').execute()
      return rows.map(toProvider)
    },

    async findProvider(slug) {
      const row = await trx
        .selectFrom('provider')
        .selectAll()
        .where('slug', '=', slug)
        .executeTakeFirst()
      return row ? toProvider(row) : null
    },

    async listForUser(userId) {
      const rows = await trx
        .selectFrom('provider_credential')
        .select(SUMMARY_COLUMNS)
        .where('user_id', '=', userId)
        .where('status', '!=', 'revoked')
        .orderBy('provider')
        .execute()

      // The row here has no sealed bytes at all, by construction: the select list
      // never asked for them.
      return rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        kind: row.kind,
        label: row.label,
        lastFour: row.last_four,
        status: row.status,
        verifiedAt: row.verified_at,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
      }))
    },

    async findActive(userId, provider) {
      const row = await trx
        .selectFrom('provider_credential')
        .selectAll()
        .where('user_id', '=', userId)
        .where('provider', '=', provider)
        .where('status', '=', 'active')
        .orderBy('created_at', 'desc')
        .executeTakeFirst()
      return row ? toStored(row) : null
    },

    async findById(userId, id) {
      const row = await trx
        .selectFrom('provider_credential')
        .selectAll()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? toStored(row) : null
    },

    async insert(input) {
      const row = await trx
        .insertInto('provider_credential')
        .values({
          id: input.id,
          user_id: input.userId,
          provider: input.provider,
          kind: input.kind,
          label: input.label,
          kek_provider: input.kekProvider,
          kek_id: input.sealed.kekId,
          wrapped_dek: input.sealed.wrappedDek,
          dek_nonce: input.sealed.dekNonce,
          secret_ciphertext: input.sealed.secretCiphertext,
          secret_nonce: input.sealed.secretNonce,
          aad_version: input.sealed.aadVersion,
          algorithm: input.sealed.algorithm,
          fingerprint: input.fingerprint,
          last_four: input.lastFour,
        })
        .returning(SUMMARY_COLUMNS)
        .executeTakeFirstOrThrow()

      return {
        id: row.id,
        provider: row.provider,
        kind: row.kind,
        label: row.label,
        lastFour: row.last_four,
        status: row.status,
        verifiedAt: row.verified_at,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
      }
    },

    async markVerified(id, at) {
      await trx
        .updateTable('provider_credential')
        .set({ verified_at: at, status: 'active', auth_failures: 0 })
        .where('id', '=', id)
        .execute()
    },

    async recordAuthFailure(id) {
      // Three consecutive failures mark it invalid. Otherwise every queued job
      // keeps burning attempts against a key the provider already rejected, and
      // some providers rate-limit on failed auth.
      const row = await trx
        .updateTable('provider_credential')
        .set((eb) => ({ auth_failures: eb('auth_failures', '+', 1) }))
        .where('id', '=', id)
        .returning('auth_failures')
        .executeTakeFirst()

      const failures = row?.auth_failures ?? 0

      if (failures >= 3) {
        await trx
          .updateTable('provider_credential')
          .set({ status: 'invalid' })
          .where('id', '=', id)
          .execute()
      }

      return failures
    },

    async revoke(id, at) {
      await trx
        .updateTable('provider_credential')
        .set({ status: 'revoked', revoked_at: at })
        .where('id', '=', id)
        .execute()
    },

    async recordEvent(input) {
      await trx
        .insertInto('credential_event')
        .values({
          credential_id: input.credentialId,
          user_id: input.userId,
          provider: input.provider,
          action: input.action,
          detail: (input.detail ?? {}) as never,
          ip_hash: input.ipHash,
        })
        .execute()
    },
  }
}

// --- M3: the price index --------------------------------------------------------

function makeCatalog(trx: Transaction<Database>): CatalogRepo {
  return {
    async list() {
      // Left join on the CURRENT price row, so a model with no published price is
      // still listed. Hiding those would make thirteen providers look like they
      // publish more than they do — fal alone lists 513 image models whose price
      // is not in its catalogue payload.
      const rows = await trx
        .selectFrom('model')
        .innerJoin('provider', 'provider.slug', 'model.provider')
        .leftJoin('price', (join) =>
          join.onRef('price.model_id', '=', 'model.id').on('price.effective_to', 'is', null),
        )
        .where('model.active', '=', true)
        .where('provider.active', '=', true)
        .select([
          'model.id as model_id',
          'model.provider as provider',
          'provider.name as provider_name',
          'model.name as name',
          'model.family as family',
          'model.tasks as tasks',
          'model.watermark as watermark',
          'model.thumbnail_url as thumbnail_url',
          'price.basis as basis',
          'price.unit_nano as unit_nano',
          'price.tokens_per_image as tokens_per_image',
          'price.formula as formula',
          'price.source as source',
          'price.collected_at as collected_at',
          'price.method as method',
          'price.note as note',
        ])
        .execute()

      return rows.map((row) => ({
        modelId: row.model_id,
        provider: row.provider,
        providerName: row.provider_name,
        name: row.name,
        family: row.family,
        tasks: row.tasks,
        watermark: row.watermark,
        thumbnailUrl: row.thumbnail_url,
        price:
          row.basis === null || row.unit_nano === null
            ? null
            : {
                basis: row.basis,
                unitNano: row.unit_nano,
                tokensPerImage: row.tokens_per_image,
                // jsonb hands money back as a STRING, because JSON has no bigint.
                // Without this the pure pricing function multiplies a string and
                // throws "Cannot mix BigInt and other types" — at request time.
                formula: formulaFromJson(row.formula),
                source: row.source ?? '',
                collectedAt: row.collected_at ?? new Date(0),
                method: row.method ?? 'doc',
                note: row.note,
              },
      }))
    },
  }
}
