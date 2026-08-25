import { sql, type Kysely } from 'kysely'

/**
 * The provider catalogue and the key vault.
 *
 * Two decisions here are load-bearing.
 *
 * **There is no `base_url` column.** The destination of every outbound call is a
 * closed list in code. The server makes authenticated requests with the user's
 * paid key, so an endpoint coming from editable data is a credential
 * exfiltration route: change one row, and the next generation posts somebody's
 * key to an attacker's host. A slug selects an adapter; it does not supply a URL.
 *
 * **`provider_credential` is write-only.** No route reads a secret back, not even
 * masked behind a "reveal" button. A read route is exactly what an authorization
 * bug turns into a mass leak, and an XSS in the front end would drain the vault
 * through the user's own session. The screen shows the last four characters and
 * when the key was last verified.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- provider catalogue -----------------------------------------------------
  //
  // Public reference data: no user owns a row, so row level security is not
  // enabled here. That is a decision, not an omission — every table that holds
  // user data has it, and this one holds none.

  await sql`
    CREATE TABLE provider (
      slug                text PRIMARY KEY,
      name                text NOT NULL,
      active              boolean NOT NULL DEFAULT true,
      -- Five values because the providers genuinely disagree. fal sends
      -- "Authorization: Key <token>" — literally "Key", not "Bearer" — BFL uses
      -- "x-key", Google uses "x-goog-api-key" and Segmind uses "x-api-key".
      -- Segmind answers 401 if BOTH Authorization and x-api-key are present, so
      -- a client that injects a global Bearer breaks it.
      auth_style          text NOT NULL CHECK (auth_style IN ('bearer', 'key', 'x-api-key', 'x-key', 'x-goog-api-key')),
      mode                text NOT NULL CHECK (mode IN ('sync', 'queue', 'both')),
      concurrency_default smallint NOT NULL DEFAULT 2,
      -- How long the provider's output URL stays alive. BFL is TEN MINUTES and
      -- Replicate is one hour, after which the record is deleted too. This column
      -- is the clock the ingestion queue orders by, not a note.
      output_ttl_seconds  integer,
      cost_in_response    text NOT NULL DEFAULT 'none' CHECK (cost_in_response IN ('exact', 'units', 'none')),
      doc_url             text,
      -- Shown on the model card. Compliance facts a user must see BEFORE
      -- spending, such as Google watermarking every image with SynthID.
      notice              text,
      verified_at         timestamptz
    )
  `.execute(db)

  const providers: Array<{
    slug: string
    name: string
    active: boolean
    auth: string
    mode: string
    ttl: number | null
    cost: string
    doc: string
    notice: string | null
  }> = [
    {
      slug: 'fal',
      name: 'fal.ai',
      active: true,
      auth: 'key',
      mode: 'both',
      ttl: null,
      cost: 'units',
      doc: 'https://docs.fal.ai',
      notice: null,
    },
    {
      slug: 'replicate',
      name: 'Replicate',
      active: true,
      auth: 'bearer',
      mode: 'queue',
      ttl: 3600,
      cost: 'none',
      doc: 'https://replicate.com/docs',
      notice:
        'Output URLs and the prediction record are deleted after one hour. No billing API: the ledger is an estimate for this provider, and the screen says so.',
    },
    {
      slug: 'runware',
      name: 'Runware',
      active: true,
      auth: 'bearer',
      mode: 'both',
      ttl: null,
      cost: 'exact',
      doc: 'https://runware.ai/docs',
      notice: 'Returns the exact cost per request when includeCost is set.',
    },
    {
      slug: 'bfl',
      name: 'Black Forest Labs',
      active: true,
      auth: 'x-key',
      mode: 'queue',
      ttl: 600,
      cost: 'exact',
      doc: 'https://docs.bfl.ai',
      notice:
        'Generated images expire after TEN MINUTES. A late worker loses an image that was already paid for.',
    },
    {
      slug: 'openai',
      name: 'OpenAI',
      active: true,
      auth: 'bearer',
      mode: 'sync',
      ttl: null,
      cost: 'units',
      doc: 'https://platform.openai.com/docs/guides/image-generation',
      notice:
        'Image models may require organization verification with a government ID before a valid key is accepted.',
    },
    {
      slug: 'google',
      name: 'Google Gemini',
      active: true,
      auth: 'x-goog-api-key',
      mode: 'sync',
      ttl: null,
      cost: 'units',
      doc: 'https://ai.google.dev/gemini-api/docs/image-generation',
      notice:
        'Every generated image carries a SynthID watermark: invisible, not removable and not optional.',
    },
    {
      slug: 'kie',
      name: 'KIE.ai',
      active: true,
      auth: 'bearer',
      mode: 'queue',
      ttl: null,
      cost: 'units',
      doc: 'https://docs.kie.ai',
      notice: null,
    },
    {
      slug: 'wavespeed',
      name: 'WaveSpeed AI',
      active: true,
      auth: 'bearer',
      mode: 'both',
      ttl: null,
      cost: 'units',
      doc: 'https://wavespeed.ai/docs',
      notice:
        'A new account gets 2 concurrent tasks and 5 predictions per minute, which will queue a fan-out rather than run it.',
    },
    {
      slug: 'together',
      name: 'Together AI',
      active: true,
      auth: 'bearer',
      mode: 'sync',
      ttl: null,
      cost: 'none',
      doc: 'https://docs.together.ai',
      notice:
        'Its CDN answers 403 to a blank User-Agent, which loses an image that was already paid for.',
    },
    {
      slug: 'novita',
      name: 'Novita AI',
      active: true,
      auth: 'bearer',
      mode: 'queue',
      ttl: null,
      cost: 'none',
      doc: 'https://novita.ai/docs',
      notice: null,
    },
    {
      slug: 'deepinfra',
      name: 'DeepInfra',
      active: true,
      auth: 'bearer',
      mode: 'sync',
      ttl: null,
      cost: 'none',
      doc: 'https://deepinfra.com/docs',
      notice:
        'The only one with full OpenAI-compatible image endpoints, so it is the canonical adapter the others are described as deviations from.',
    },
    {
      slug: 'segmind',
      name: 'Segmind',
      active: true,
      auth: 'x-api-key',
      mode: 'both',
      ttl: null,
      cost: 'none',
      doc: 'https://docs.segmind.com',
      notice: 'Sending Authorization and x-api-key together returns 401.',
    },
    // Off by default, and the reason is a trap worth keeping written down: the
    // route still answers 401, so a naive health check reports "provider OK" and
    // the discovery would come at spending time.
    {
      slug: 'fireworks',
      name: 'Fireworks AI',
      active: false,
      auth: 'bearer',
      mode: 'sync',
      ttl: null,
      cost: 'none',
      doc: 'https://docs.fireworks.ai',
      notice:
        'DISCONTINUED. The changelog dated 2026-06-10 says image generation is deprecated. The HTTP route still answers 401, so a naive health check would call it healthy.',
    },
  ]

  for (const p of providers) {
    await sql`
      INSERT INTO provider (slug, name, active, auth_style, mode, output_ttl_seconds, cost_in_response, doc_url, notice)
      VALUES (${p.slug}, ${p.name}, ${p.active}, ${p.auth}, ${p.mode}, ${p.ttl}, ${p.cost}, ${p.doc}, ${p.notice})
    `.execute(db)
  }

  // --- the vault --------------------------------------------------------------

  await sql`
    CREATE TABLE provider_credential (
      id                uuid PRIMARY KEY,
      user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      provider          text NOT NULL REFERENCES provider (slug),
      kind              text NOT NULL CHECK (kind IN ('api_key', 'oauth_refresh', 'webhook_secret')),
      label             text,

      kek_provider      text NOT NULL DEFAULT 'env' CHECK (kek_provider IN ('env', 'awskms', 'gcpkms')),
      kek_id            text NOT NULL,
      wrapped_dek       bytea NOT NULL,
      dek_nonce         bytea NOT NULL,
      secret_ciphertext bytea NOT NULL,
      secret_nonce      bytea NOT NULL,
      aad_version       smallint NOT NULL DEFAULT 1,
      -- An allowlist of ONE, and it never selects the decryptor: the application
      -- compares it against a constant. Letting a column choose the algorithm is
      -- how an attacker with write access downgrades the cipher — the same shape
      -- as a JWT library that honours the 'alg' header.
      algorithm         text NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm = 'AES-256-GCM'),

      -- HMAC of the plaintext under the pepper. Detects a duplicate, and matches
      -- "this key was revoked at the provider", without decrypting anything.
      fingerprint       bytea NOT NULL,
      last_four         text NOT NULL,

      status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid', 'revoked')),
      auth_failures     smallint NOT NULL DEFAULT 0,
      verified_at       timestamptz,
      last_used_at      timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now(),
      revoked_at        timestamptz
    )
  `.execute(db)

  await sql`
    CREATE UNIQUE INDEX provider_credential_unique_active
      ON provider_credential (user_id, provider, fingerprint)
      WHERE status = 'active'
  `.execute(db)

  await sql`
    CREATE INDEX provider_credential_lookup
      ON provider_credential (user_id, provider)
      WHERE status = 'active'
  `.execute(db)

  // This partial index IS the rewrap work queue: "every active row still sealed
  // under the old KEK". Without it, rotating a leaked key means a full scan and
  // a guess about what is left.
  await sql`
    CREATE INDEX provider_credential_kek
      ON provider_credential (kek_id)
      WHERE status = 'active'
  `.execute(db)

  // --- audit ------------------------------------------------------------------
  //
  // No foreign key to the credential, deliberately: the trail has to survive the
  // DELETE, otherwise an audit of deletions does not exist.

  await sql`
    CREATE TABLE credential_event (
      id            bigserial PRIMARY KEY,
      credential_id uuid,
      user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      provider      text NOT NULL,
      action        text NOT NULL CHECK (action IN ('created', 'verified', 'used', 'auth_failed', 'rewrapped', 'revoked', 'deleted')),
      -- FORBIDDEN to contain a secret, and that is a CI test that greps, not a
      -- paragraph in a README.
      detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip_hash       bytea,
      at            timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE INDEX credential_event_by_user ON credential_event (user_id, at DESC)`.execute(
    db,
  )
  await sql`CREATE INDEX credential_event_by_credential ON credential_event (credential_id, at DESC)`.execute(
    db,
  )
  await sql`CREATE INDEX credential_event_by_action ON credential_event (action, at DESC)`.execute(
    db,
  )

  // --- row level security -----------------------------------------------------

  for (const table of ['provider_credential', 'credential_event']) {
    await sql`ALTER TABLE ${sql.ref(table)} ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE ${sql.ref(table)} FORCE ROW LEVEL SECURITY`.execute(db)

    await sql`
      CREATE POLICY ${sql.ref(`${table}_own`)} ON ${sql.ref(table)}
        USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    `.execute(db)
  }

  // The catalogue is readable by the application without a scope, because it
  // belongs to nobody. Writes to it happen through migrations only.
  await sql`GRANT SELECT ON provider TO prumo_app`.execute(db)
  await sql`REVOKE INSERT, UPDATE, DELETE ON provider FROM prumo_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS credential_event`.execute(db)
  await sql`DROP TABLE IF EXISTS provider_credential`.execute(db)
  await sql`DROP TABLE IF EXISTS provider`.execute(db)
}
