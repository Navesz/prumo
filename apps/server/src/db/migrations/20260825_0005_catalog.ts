import { sql, type Kysely } from 'kysely'

/**
 * The price index: models, and what each one costs where.
 *
 * This is the table a person reads BEFORE deciding which provider is worth
 * opening an account with. It is public — no login, no key — because the whole
 * reason to hand Prumo a key is having seen a price first.
 *
 * **Price is a formula, not a float.** DeepInfra charges
 * `$0.009 x (w/1024) x (h/1024) x (steps/25)`. Together charges FLUX1.1[pro] per
 * MEGAPIXEL and schnell per IMAGE. BFL charges the first megapixel and adds the
 * rest. A catalogue of "USD per image" is wrong for at least five providers, and
 * a router built on it picks the wrong route with total confidence.
 *
 * **Every row carries where the number came from and when.** `source`,
 * `collected_at` and `method` are NOT NULL. A price without a source is not a
 * price, it is folklore — and above thirty days old it drops out of the ranking
 * on its own rather than quietly aging into a lie.
 *
 * Neither table has row level security: nobody owns a price. Every other table in
 * this database that holds user data has it, and these hold none.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE model (
      -- Provider-qualified, because a sub-endpoint IS a different model: the
      -- inpainting route of a family takes a different schema from the base one.
      -- There is no derivable id here: a path at WaveSpeed, a bare string at KIE,
      -- a versioned AIR at Runware, owner/name plus a hash at Replicate.
      id              text PRIMARY KEY,
      provider        text NOT NULL REFERENCES provider (slug),
      endpoint_id     text NOT NULL,
      name            text NOT NULL,
      family          text,
      tasks           text[] NOT NULL DEFAULT '{}',
      -- Compliance facts a screen must be able to show without asking anybody:
      -- Google watermarks every image with SynthID, invisibly and permanently.
      watermark       text NOT NULL DEFAULT 'unknown' CHECK (watermark IN ('synthid', 'none', 'unknown')),
      license         text,
      thumbnail_url   text,
      description     text,
      active          boolean NOT NULL DEFAULT true,
      discontinued_at timestamptz,
      first_seen_at   timestamptz NOT NULL DEFAULT now(),
      last_seen_at    timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE UNIQUE INDEX model_endpoint ON model (provider, endpoint_id)`.execute(db)
  await sql`CREATE INDEX model_family ON model (family) WHERE active`.execute(db)
  await sql`CREATE INDEX model_tasks ON model USING gin (tasks)`.execute(db)

  await sql`
    CREATE TABLE price (
      id             bigserial PRIMARY KEY,
      model_id       text NOT NULL REFERENCES model (id) ON DELETE CASCADE,

      -- Append-only: a row is never edited, only closed with effective_to. That
      -- is what makes the history a history instead of a claim about today.
      effective_from timestamptz NOT NULL DEFAULT now(),
      effective_to   timestamptz,

      basis          text NOT NULL CHECK (basis IN ('per_image', 'per_megapixel', 'per_step', 'per_second', 'per_output_token', 'formula')),
      -- Price of ONE unit of 'basis', in nano-USD. Integer, never a float:
      -- images at US$ 0.0005 exist, and rounding to cents collapses two routes
      -- with different prices into the same number, which is the product.
      unit_nano      bigint NOT NULL CHECK (unit_nano >= 0),
      -- For 'formula': a CLOSED, discriminated shape with numeric parameters,
      -- evaluated by a pure function. Never an expression to interpret. Nothing
      -- in this database is ever eval'd.
      formula        jsonb,
      currency       char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),

      -- How many output tokens one image costs, for providers that bill per
      -- token (OpenAI, Google). Without it their price is not comparable to a
      -- per-image price, and the honest answer on screen is "not comparable"
      -- rather than a number nobody can defend.
      tokens_per_image integer,

      source         text NOT NULL,
      collected_at   timestamptz NOT NULL,
      method         text NOT NULL CHECK (method IN ('doc', 'api', 'measured', 'estimated')),
      note           text
    )
  `.execute(db)

  await sql`CREATE UNIQUE INDEX price_current ON price (model_id) WHERE effective_to IS NULL`.execute(
    db,
  )
  await sql`CREATE INDEX price_history ON price (model_id, effective_from DESC)`.execute(db)
  await sql`CREATE INDEX price_freshness ON price (collected_at DESC)`.execute(db)

  // Catalogue data: the application reads it and never writes it. Writes come
  // from the collector, which runs as the owner.
  await sql`GRANT SELECT ON model, price TO prumo_app`.execute(db)
  await sql`REVOKE INSERT, UPDATE, DELETE ON model, price FROM prumo_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS price`.execute(db)
  await sql`DROP TABLE IF EXISTS model`.execute(db)
}
