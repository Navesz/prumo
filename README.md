# Prumo

> Open-source image generation with your own provider keys: fire one prompt at several
> models at once, see what each image costs before you spend, and let the database
> refuse the ones that would break your cap.

[![CI](https://github.com/Navesz/prumo/actions/workflows/ci.yml/badge.svg)](https://github.com/Navesz/prumo/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha%20%C2%B7%20nothing%20runs%20yet-red)](#status)

[Leia em português](README.pt-BR.md) · [Plan (pt-BR)](PLANO.md) · [Contribute](CONTRIBUTING.md) · [Security](SECURITY.md)

## What this is

Prumo is a self-hosted studio for paid image models. You create an account on your own
instance, paste your own API keys for the providers you already pay — fal.ai, Replicate,
KIE.ai, OpenAI, Google, BFL, Runware, WaveSpeed, Together, Novita, DeepInfra, Segmind —
and generate: the same prompt dispatched to several models at the same time, the estimated
cost of every route on screen _before_ the click, a spending cap the database enforces
rather than the UI suggests, a gallery, a ledger, and a price index that says which
provider runs a given model cheapest today. There is no middleman taking a margin: the
money goes straight from your key to the provider, at the provider's own price.

## Status

**M0/M1 under construction. Nothing of the product works yet.**

At the time of writing, this repository contains a build plan, a database schema, a
provider survey, the vendored tooling and the M1 skeleton: a typed contract, one
migration, an account with a session, forced row level security, and a spending cap the
database enforces. There is **no provider adapter and no generation** — nothing produces
an image. `docker compose up -d`
fails, because there is nothing to compose.

Concretely, against the milestones in [PLANO.md](PLANO.md):

| Milestone | What it delivers                                                | State       |
| --------- | --------------------------------------------------------------- | ----------- |
| M0        | Verification gate, branch protection, secret scanning           | in progress |
| M1        | Empty vertical skeleton: compose, migrations, contract, RLS     | in progress |
| M2        | Key vault                                                       | not started |
| M3        | Studio: one image, one model, with the money closing            | not started |
| M4        | Fan-out, slots, EDF queue, `duvida_de_cobranca`                 | not started |
| M5–M9     | Gallery and mobile, live price index, img2img, curation, public | not started |

Do not point a valuable API key at this. Not because a specific hole is known, but because
the vault (M2) has not been written, let alone reviewed. When there is something to run,
this section will say so with a version number.

## Why

**The same model costs different money at different providers, and it is not a rounding
difference.** Two providers, one shared catalogue, read from their own public price pages
on 2026-08-24:

| Model, 1024×1024 | DeepInfra                                                       | Together              | Gap                                 |
| ---------------- | --------------------------------------------------------------- | --------------------- | ----------------------------------- |
| FLUX.2 [pro]     | $0.015 / image                                                  | $0.03 / image         | **2.0×**                            |
| FLUX.2 [dev]     | `$0.01 × (w/1024) × (h/1024) × (steps/28)` → $0.010 at 28 steps | $0.0154 / image       | **1.5×**                            |
| FLUX.1 [schnell] | `$0.0005 × (w/1024) × (h/1024) × steps` → $0.0020 at 4 steps    | $0.0027 / image       | **1.35×**                           |
| FLUX1.1 [pro]    | $0.04 / image                                                   | $0.04 / **megapixel** | equal at 1 MP, **2×** apart at 2 MP |

Sources: `deepinfra.com/pricing`, `together.ai/pricing`, both read on 2026-08-24, method
`doc` — read from documentation, never called with a real key, never measured. They may
already be stale as you read this, which is the whole reason every price row in Prumo
carries `fonte`, `coletado_em` and `metodo`, and drops out of the ranking automatically
after 30 days.

That last row is the part a spreadsheet gets wrong. **Price is a formula, not a float.**
DeepInfra bills FLUX.1[dev] as `$0.009 × (w/1024) × (h/1024) × (iters/25)`; Together bills
FLUX1.1[pro] per megapixel and schnell per image; BFL bills the first megapixel and adds
the rest. A catalogue of "USD per image" computes the wrong number for at least five of
the thirteen providers, and then a router picks the wrong route with confidence.

**And the aggregators sell you a subscription for something that is pay-as-you-go
underneath.** A monthly plan converts a variable cost you could pay directly into a fixed
one plus a margin, usually denominated in credits that expire. That is a reasoning about
the business model, not a measurement of any specific vendor's price sheet — we have not
verified one. What Prumo does instead is show you the estimate for the route you are about
to fire, and refuse the click when it would break your cap.

## How it works

```text
  prompt + 8 selected routes
       |
       v
  POST /lotes    command_id is a UUID v7 minted by the browser
       |
       |   ONE transaction. Zero outbound HTTP calls inside it.
       +---> comando_processado : INSERT. PK violation means it already happened;
       |                          the stored answer is returned, nothing is charged twice
       +---> price              : pure function over the discriminated formula in `preco`.
       |                          Never an interpreted expression, never eval
       +---> RESERVE            : conditional UPDATE on `orcamento`, fixed order: mes, then sessao.
       |                          Zero rows affected = over the cap = the batch is refused
       +---> lote + N geracao + N lancamento(reserve) + N tarefa
       |
     COMMIT ---> NOTIFY
       |
       v
  worker : take a `slot_provedor` row, then a `tarefa` row,
           both with FOR UPDATE SKIP LOCKED, slot first. No slot, no work.
           Ordering is EDF — earliest deadline first — not FIFO.
       |
       +--[ despachar ]--> open the vault, POST to the provider with the user's key
       +--[ sondar    ]--> reschedules itself, backoff 2 -> 5 -> 10 -> 20 s, never under 2 s
       +--[ ingerir   ]--> priority 0: stream the bytes down, SHA-256 on the way through,
       |                   push to storage, 3 variants + thumbhash, settle the ledger
       v
  galeria  <--- SSE, one connection per tab, carrying scoped invalidation and state only
```

Two things in that picture are load-bearing.

**The cap is a WHERE clause, not an `if`.** The reservation is the check:

```sql
UPDATE orcamento
   SET reservado_nano = reservado_nano + $custo
 WHERE usuario_id = $u AND janela = $j AND janela_inicio = $i
   AND gasto_nano + reservado_nano + $custo <= teto_nano
RETURNING teto_nano - gasto_nano - reservado_nano AS folga;
```

Zero rows affected means the cap is blown. Because the condition of the rule _is_ the
condition of the write, there is no window between checking and debiting, and eight models
fired in the same millisecond cannot structurally slip past the limit. Money is an integer
in nano-USD (`bigint`, 1 = 1e-9 USD) — never a float, because there are images at
US$ 0.0005 and cents truncate the product.

**Nothing is "done" before the bytes are in Prumo's own storage.** A BFL output URL lives
ten minutes; a Replicate output URL and its whole record live one hour. That is why the
queue orders by deadline: under FIFO, a worker eleven minutes behind loses an image you
already paid for, and nobody sees an error, because nothing failed — the link just died.

The other rule the diagram enforces silently: **no HTTP call inside a transaction.** Open a
transaction, call fal, hit a deadlock, the transaction retries — and calls fal again. Two
images, two charges. External effects do not roll back. `dependency-cruiser` forbids
`dominio/` and `app/` from importing an HTTP client at all, so it is a gate, not a
paragraph in a guide.

## Your keys

Read this before pasting anything.

Your keys are stored **encrypted at rest on the server**: AES-256-GCM envelope encryption,
a 32-byte DEK per credential, wrapped by a KEK held in `PRUMO_KEK`. Plain `node:crypto`,
zero dependencies. The additional authenticated data is recomputed from the row
(`v1|id|usuario_id|provedor|tipo`) and never stored, so someone with write access to the
database cannot move your key row onto another account and keep a valid GCM tag.

**Whoever hosts the instance can read the keys of every user on it.** Including the owner
of the official instance, if one ever exists. This is a vault whose security model is trust
in the operator, not secrecy from the operator: with the KEK in the process environment, an
operator — or anyone with code execution on that host — can decrypt. Encryption at rest
protects against what is actually likely on a personal project: a leaked database dump, a
stray backup, a restored replica, SQL injection. It does not protect against a compromised
host. This sentence is on the key-registration screen too, not just here.

The browser-side, zero-knowledge design was considered and rejected on technical grounds,
not preference: fal states in writing that most production applications need a server-side
proxy, Replicate blocks CORS in practice and OpenAI, Google and BFL do too, no provider
offers an ephemeral browser token, and — decisively — fan-out with a queue, retries and
webhooks needs a worker that keeps working after the tab is closed. Zero-knowledge and
background work do not coexist. Offering both would be theatre.

**So: create a key dedicated to Prumo, with a spending limit set in the provider's own
dashboard, and revoke it there when you stop using it.** The Prumo cap is not the provider
cap; it is a second, softer line. 🔴 Which of the thirteen providers actually support a
per-key spending limit has not been verified.

Consequences that bind the whole project, listed here because they are visible in the code:
`axios` is banned everywhere (its error object carries `config.headers`, and one
`console.error(err)` in a rare branch publishes a user's key into the log); provider errors
are sanitised before being stored, because some echo part of the received header back;
CI greps a full run's log for the test key prefix and fails if it finds it; and
`npm run backup` refuses to include `.env`, because an encrypted database backup stored
next to its KEK is not a backup of an encrypted database.

More detail, and how to report a hole: [SECURITY.md](SECURITY.md).

## Supported providers

Surveyed on 2026-08-24 against each provider's official documentation, and written up in
[docs/PROVEDORES.md](docs/PROVEDORES.md) (Portuguese) with endpoints, sources and traps.
Surveyed is not implemented: **no adapter exists yet**, so every status below is planned.

| Provider      | Auth header                       | Mode         | Cost in the response    | Adapter         | Trap that shapes the architecture                                                                                       |
| ------------- | --------------------------------- | ------------ | ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| fal.ai        | `Authorization: Key` (not Bearer) | queue + sync | partial                 | ⬜ planned      | HTTP body is **flat**; the `{"input":{…}}` in snippets is an SDK signature. Webhooks redelivered up to 31×              |
| Replicate     | `Bearer`                          | queue        | no                      | ⬜ planned      | Output URL **and the record** are deleted after 1 h. No billing API, so the ledger is an estimate forever. CORS blocked |
| KIE.ai        | `Bearer`                          | queue        | partial                 | ⬜ planned      | `resultJson` arrives as a **string containing JSON**. Two API generations coexist                                       |
| WaveSpeed     | `Bearer`                          | queue + sync | partial                 | ⬜ planned      | **Bronze tier = 2 concurrent, 5/min** — kills fan-out on a new account. Has a pre-flight price endpoint in USD          |
| Runware       | `Bearer` or auth task             | both         | **yes** (`includeCost`) | ⬜ planned      | The only one with **native fan-out** (heterogeneous array in one request). **Partial** failure is the normal case       |
| OpenAI        | `Bearer`                          | sync         | partial                 | ⬜ planned      | **Organisation verification with ID document and face scan.** Output always base64. CORS blocked                        |
| Google Gemini | `x-goog-api-key`                  | sync         | partial                 | ⬜ planned      | **SynthID on every image** — invisible, not removable, not optional. No free tier for image models                      |
| BFL / FLUX    | `x-key`                           | queue        | **yes**                 | ⬜ planned      | **Output URL expires in 10 minutes.** The hardest constraint in the set, and the reason the queue is EDF                |
| Together      | `Bearer`                          | sync         | no                      | ⬜ planned      | **The CDN returns 403 for a blank User-Agent** — an image you already paid for is lost                                  |
| Novita        | `Bearer`                          | queue        | no                      | ⬜ planned      | Image documentation shrank to 2 pages; classic routes return 404                                                        |
| DeepInfra     | `Bearer`                          | sync         | no                      | ⬜ planned      | **The only one with real, complete OpenAI compatibility** — it becomes the canonical adapter                            |
| Segmind       | `x-api-key`                       | both         | unknown                 | ⬜ planned      | Sending `Authorization` **and** `x-api-key` together returns 401. Any client injecting a global Bearer breaks here only |
| Fireworks     | `Bearer`                          | sync         | no                      | ⛔ **excluded** | Deprecated. See below                                                                                                   |

**Fireworks is mapped but will not get an adapter.** Its changelog entry dated 2026-06-10
reads, verbatim: `Audio inference and image generation are deprecated.` No shutdown date,
no migration guide, no replacement named; the image pages 404 and the serverless pricing
page no longer has an image section. The trap is that **the HTTP route still answers 401**,
so a naive health check would report "provider OK" and the failure would surface at spend
time. That is exactly why `provedor.ativo` exists and why the monitor has to distinguish
"route alive" from "model exists". Twelve slugs are planned as adapters; the thirteenth is
documentation of a corpse.

There is deliberately **no `base_url` column** in the database. Every outbound destination
is a closed list in code, because the server makes authenticated requests with the user's
key — any endpoint coming from editable data is a credential exfiltration route.

## Quick start

**None of this works today.** There is no `compose.yaml`, no Dockerfile and no migration in
the tree. What follows is the M1 acceptance criterion written down in advance, so the shape
is fixed before the code exists.

Requirements: Docker Engine with Compose v2 (`docker compose`, not `docker-compose`). The
compose file will bring up two services, `prumo` and `postgres:17-alpine`; Caddy is an
optional profile. For working on the code without Docker: Node 24 LTS and PostgreSQL 17.

```bash
git clone https://github.com/Navesz/prumo.git
cd prumo
cp .env.exemplo .env

# generate the 32-byte KEK that wraps every stored credential
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# or: openssl rand -base64 32
# paste the result into PRUMO_KEK in .env

docker compose up -d
```

Three commands to be up, plus the key generation. Migrations run at boot under an advisory
lock, so two containers starting at once do not race. The boot **refuses to start and names
the missing variable** rather than coming up half-configured. `PRUMO_PAPEL` selects the role
of the process — `api`, `worker` or `tudo` — and the default single-container deployment is
`tudo`: one binary serving HTTP, the worker and SSE.

Two warnings about `PRUMO_KEK`:

- **Losing it is irreversible.** Every stored credential becomes undecryptable ciphertext
  and every user has to paste their keys again. Keep an offline copy.
- **Keep that copy somewhere other than the database backup.** The single most likely way
  to nullify this entire vault is a backup archive containing both the encrypted rows and
  the key that opens them.

`PRUMO_MODO=pessoal` closes registration, which is the right setting for an instance with
one user.

## How it compares

Generating images through a hosted product is a well-served market, and for most of it
there are better answers than this one. The honest positioning:

| Alternative                                                               | Where it beats Prumo                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Higgsfield** and other subscription studios                             | They exist and work right now. Polished interface, curated model list, nothing to host, no provider accounts, no card entered in twelve places, support when it breaks. If you want an image this afternoon, that is the answer and this is not. Their price sheets have not been verified here |
| **The providers' own playgrounds** (fal, Replicate, Runware, BFL, OpenAI) | First-party. Every new model on launch day, exact billing from the company actually charging you, and no third party holding your key. Prumo will always lag a launch by however long an adapter takes to write                                                                                 |
| **OpenRouter**                                                            | One account, one balance, one key, hosted and mature, with real uptime behind it. You never manage twelve provider accounts or twelve invoices. Prumo asks you to open an account and put a card at each provider you want to use                                                               |

Where Prumo intends to be different: the estimated cost of each route on screen before the
click, with the estimate labelled as exact or derived rather than presented as fact; a cap
the database enforces, so eight simultaneous generations cannot collectively overspend it;
money going straight to the provider at the provider's own price, with no margin in
between; and a price index that carries source, date and method per row and retires
automatically when it goes stale. Plus the code that produced the number, readable.

None of that is true today. Everything in this section is intent, and the section above
called "Status" is the measurement.

## Project layout

What exists in the tree today:

```text
PLANO.md              The build plan, v2. Portuguese. The source of truth for every decision
docs/ESQUEMA.md       The 21 tables, column by column, with what breaks when each is violated
docs/PROVEDORES.md    The 13 providers: auth, endpoints, limits, traps, sources
ferramental/          Verification gate, layer boundaries, secret scan, link check, hooks.
                      Vendored from the private repo Navesz/alicerce and deliberately kept
                      under its original Portuguese names, so it can be resynced upstream
adr/                  Decision records, including nano-USD money and pt-BR interface
.ai/                  Agent policy: one source that generates CLAUDE.md and AGENTS.md
.github/              Workflows, issue forms and the pull-request template
```

What the milestones will add:

```text
packages/contrato/    ts-rest + Zod. The whole route, with response validation on
src/dominio/          Pure rules: price formulas, budget windows, state machines. No I/O
src/app/              Use cases. One transaction each, through the single UnitOfWork
src/http/             Fastify 5, serving the API and the Vite build from one origin
src/db/               Kysely + pg, migrations, repositories
src/provedores/       One adapter per provider. The only place that speaks HTTP outward
src/armazenamento/    The Blobs interface: `disco` driver by default, `s3` optional
src/cofre/            Envelope encryption. node:crypto only
apps/web/             React 19, Vite 8, TanStack Router/Query, Tailwind 4, shadcn on Base UI
```

The boundaries are enforced by `dependency-cruiser`, not by convention: `provedores/` may
not import `db/` or `dominio/`; `dominio/` and `app/` may not import an HTTP client, S3 or
`fs`. Every rule ships with a planted violation that proves the rule fails the build — a
boundary rule that has never fired may simply be broken, and one in the reference codebase
spent months reporting no violations while React sat inside the domain.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first, then
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Two issue templates exist for this domain
specifically: price correction and new provider. A price correction without `fonte`,
`coletado_em` and `metodo` cannot be merged — it is not a correction, it is a different
rumour.

Rules worth knowing before your first pull request:

- **Language.** Code, API, commit messages, issues and documentation are in **English**.
  Only `PLANO.md`, `docs/ESQUEMA.md`, `docs/PROVEDORES.md`, `README.pt-BR.md` and `.ai/`
  are in Portuguese. `ferramental/` keeps its Portuguese names because it is vendored.
- **`axios` is banned** in the entire project. Use `fetch`/undici.
- **Money is an integer in nano-USD.** Never a float, never a decimal string.
- **The spending cap is enforced by a conditional UPDATE**, never by a read-then-write.
- **No HTTP call inside a database transaction.** The boundary checker enforces it.
- `npm run verificar` is the single command that decides whether your work is done:
  instructions, formatting, types, lint, boundaries, tests, build.
- Workflows triggered by a fork receive no secrets. A pull request from a stranger with
  access to secrets is exfiltration in one commit.

Marks used across the documentation: ✅ proven · 🧪 decided but not measured · 🔴 blocks
code. Treating a 🧪 as a ✅ is the exact mistake the notation exists to prevent — this
architecture is decided, not measured, and everything describing behaviour under
concurrency, latency or volume is 🧪 until something runs.

## License

Code is [Apache-2.0](LICENSE). The price catalogue — the provider survey and the price seed
data — is **CC BY 4.0**, so you can reuse the numbers as long as you credit where they came
from. Third-party attribution and data provenance rules are in
[THIRD_PARTY.md](THIRD_PARTY.md).

---

> Nothing here replaces human review. Prices, model licences, usage policies and any number
> in this repository produced with AI assistance must be checked by a person before being
> shown to a user as fact.
