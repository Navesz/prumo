# Third-party software, data, and services

This is the dependency and provenance policy of Prumo, not legal advice. When a
lockfile exists it is the authoritative inventory of resolved packages; this
document records the decisions and boundaries a lockfile cannot express — which
layer may import what, what is forbidden and why, and where the price data
came from.

**State, so the table is not read as a claim:** as of 2026-08-24 this repository
has no `package.json` and no product code. M0 (foundation and gate) and M1
(empty vertical skeleton) are under construction. Almost everything below is
therefore _Planned_, meaning decided in [PLANO.md](PLANO.md) and not yet
installed.

Status values used here:

| Status              | Means                                                    |
| ------------------- | -------------------------------------------------------- |
| Installed           | Present in the repository today                          |
| Planned             | Decided in `PLANO.md`, not yet installed                 |
| Evaluated candidate | Considered, admitted only against a measured need        |
| Reference           | Read and learned from; not a dependency                  |
| Prohibited          | Must not appear in any manifest, at any depth we control |

## Current and planned technology

| Project                                              | Status              | Role and boundary                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ferramental/` (vendored from `Navesz/alicerce`)     | Installed           | Verification gate, layer-boundary presets, secret scanner, link checker, git hooks. Vendored copy — see the dedicated section below.                                                                                                                                                                       |
| Node.js 24 LTS                                       | Planned             | The single runtime. One binary serves HTTP, worker and SSE, selected by `PRUMO_PAPEL` (`api`, `worker`, `tudo`). No second language in the server path.                                                                                                                                                    |
| TypeScript ~6, `strict` + `noUncheckedIndexedAccess` | Planned             | Compile-time contract only. Money is `bigint` nano-USD; a type that lets a price become `number` has failed at its one job.                                                                                                                                                                                |
| Fastify 5, `@fastify/static`                         | Planned             | HTTP server, and it also serves the Vite build so the SPA has a single origin. Route handlers hold no business rule; they call `app/`.                                                                                                                                                                     |
| ts-rest 3.52 + Zod 3.25                              | Planned             | One contract typing both ends, response validation **on**. OpenAPI is generated from the contract, never hand-written beside it. Zod is allowed in `dominio/` by name; it is the single exception in an otherwise total denylist.                                                                          |
| Kysely 0.28 + `pg` 8.13                              | Planned             | The only way to reach Postgres. One pool, one transaction API. `dominio/` never sees it.                                                                                                                                                                                                                   |
| PostgreSQL 17 (PostgreSQL License)                   | Planned             | Database, queue and pub/sub at once: `FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY`, RLS, JSONB, partial indexes. Extensions limited to `pgcrypto` (only `gen_random_uuid`) and `citext`. The spend ceiling is enforced by a conditional `UPDATE` here, not by application code.                                |
| `postgres:17-alpine`, Docker, Docker Compose         | Planned             | Two services, two volumes, three commands to boot. The compose file is the deployment contract; anything not in it does not exist in production.                                                                                                                                                           |
| React 19.2                                           | Planned             | Web interface. It never reaches `dominio/` or the database types directly — only through the ts-rest client.                                                                                                                                                                                               |
| Vite 8                                               | Planned             | Frontend build. Real code splitting is a requirement, not a nicety: only `/gerar` in the initial bundle.                                                                                                                                                                                                   |
| TanStack Router + TanStack Query                     | Planned             | Routing and server-state cache. URL is state — the lightbox lives in the URL with `resetScroll:false`.                                                                                                                                                                                                     |
| Tailwind 4                                           | Planned             | Styling. The zinc base with pulled-in extremes comes from Herz `index.css`, because pure black makes a photo look cut out of the grid.                                                                                                                                                                     |
| shadcn/ui over `@base-ui/react`                      | Planned             | Components are **copied into** the repository, not imported: once copied they are project code under Apache-2.0 and are reviewed as such. Base UI (MIT) supplies behaviour and accessibility, including the Drawer the mobile layout depends on.                                                           |
| Vitest                                               | Planned             | Unit and integration tests. The ledger reconciliation is a test assertion, not a dashboard.                                                                                                                                                                                                                |
| Playwright                                           | Planned             | Browser end-to-end. It is the only thing that can prove SSE survives a real proxy, which is currently unproven.                                                                                                                                                                                            |
| oxlint                                               | Planned             | Lint. Naming matters to it: a hook named outside the `use` prefix silently disables `rules-of-hooks`, which is exactly how 24 files in Herz went unchecked.                                                                                                                                                |
| dependency-cruiser                                   | Planned             | Layer boundaries as an enforced gate: `provedores/` may not import `db/` or `dominio/`; `dominio/` and `app/` may not import an HTTP client, S3, or `fs`. That last rule is what mechanically enforces "no external I/O inside a transaction". Every rule ships with a planted violation proving it fails. |
| `sharp`                                              | Planned             | Thumbnails and variants, inside a `piscina` worker pool with `sharp.cache(false)`. Apache-2.0 itself, but it links libvips (LGPL-3.0) and ships prebuilt binaries: packaging and notice obligations get reviewed per platform before release.                                                              |
| `piscina`                                            | Planned             | `worker_threads` pool so image processing cannot block the event loop that is also serving SSE.                                                                                                                                                                                                            |
| `thumbhash`                                          | Planned             | 28-byte placeholder per image. Without it the gallery jumps as thumbnails load.                                                                                                                                                                                                                            |
| `node:crypto` (standard library)                     | Planned             | The key vault: AES-256-GCM envelope, DEK per credential, KEK from `PRUMO_KEK`. Zero dependencies **on purpose** — a supply-chain compromise in a crypto helper is a compromise of every user's paid key.                                                                                                   |
| `fetch` / undici (standard library)                  | Planned             | The only HTTP client for outbound provider calls. Destination URLs are a closed list in code; there is no `base_url` column, because a URL from editable data is a credential-exfiltration route.                                                                                                          |
| `aws4fetch`                                          | Evaluated candidate | ~5 KB SigV4 signer for the optional `s3` blob driver. The default driver is local disk; S3 is admitted when someone actually needs it, not before.                                                                                                                                                         |
| Caddy                                                | Evaluated candidate | Optional compose profile for TLS. Adding it must not become a requirement for `docker compose up`.                                                                                                                                                                                                         |
| Redis                                                | Evaluated candidate | Rejected for M0–M9. The queue is a Postgres table with `FOR UPDATE SKIP LOCKED` and a lease; a second datastore would add a second source of truth about money in flight.                                                                                                                                  |
| Contributor Covenant 2.1                             | Planned             | `CODE_OF_CONDUCT.md` will be a modified adaptation under CC BY 4.0; the attribution and per-file license notice must be preserved.                                                                                                                                                                         |
| `axios`                                              | **Prohibited**      | See below.                                                                                                                                                                                                                                                                                                 |
| `Navesz/alicerce` (private)                          | Reference           | Origin of `ferramental/` and of the invariants it enforces. The public repository must never depend on it at build or run time.                                                                                                                                                                            |
| Herz (private, same owner)                           | Reference           | Source of the reasoning, the gate, and five frontend files (~422 lines) reused almost literally. Its backend does not exist — no Fastify, no Kysely, no migration — so nothing here may be described as "the stack the owner already runs".                                                                |
| OpenKartLine (`Navesz/openkartline`, Apache-2.0)     | Reference           | Source of the community scaffolding shape: license split, `CITATION.cff`, `THIRD_PARTY.md`, governance and security documents. Same owner; reused as a model, not vendored.                                                                                                                                |

Absence from this table does not mean a package is unlicensed. Release review
uses a generated dependency inventory and preserves the required notices.

## The vendored `ferramental/`

`ferramental/` is a **copy**, taken from the private repository
`Navesz/alicerce`, of `verificar/`, `fronteiras/`, `segredo/`, `elos/`,
`portao/`, `hooks/`, `contexto/` and the CI template.

- **It is vendored so that a public repository never depends on a private one.**
  A contributor who cannot clone `alicerce` must still be able to run
  `npm run verificar` and get the same verdict CI gets. A submodule or a private
  package would make the gate unrunnable for exactly the people the gate exists
  to help.
- **The file and directory names stay in Portuguese on purpose.** Prumo's own
  code, API, commits and documentation are in English; this directory is the
  deliberate exception. Renaming it to English would make every future
  resynchronisation with `alicerce` a manual merge instead of a diff, and a
  vendored copy that cannot be cheaply resynchronised is a fork nobody
  maintains. The exception is scoped to this directory and does not license
  Portuguese identifiers anywhere else.
- **Terms.** Same owner, same author, contributed to Prumo under this
  repository's Apache License 2.0. It carries no third-party code and no
  runtime dependencies — it is plain Node with zero packages, because the thing
  that checks the build must not depend on the build.
- **Editing rule.** Fix it upstream in `alicerce` and re-copy. A local edit that
  is not carried back is silently lost on the next sync, and the gate that
  everybody trusts is the one that quietly stopped matching its source.
- **Drift is expected and must be recorded.** When a Prumo-only rule is added
  (`provedores/` may not import `db/`; no HTTP client in `dominio/`), it is
  written as a Prumo rule with its own planted-violation proof, and the
  divergence from upstream is noted in the pull request.

## Prohibited dependencies

| Package | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axios` | Its error object carries `config.headers`. One `console.error(err)` in a rare branch publishes a user's paid provider key into the log — and the log is the one place a key is never encrypted. This is not hypothetical for Prumo specifically: every outbound call carries someone else's credential in a header, so _any_ client that attaches the request configuration to the thrown error is a leak waiting for a bad day. Use `fetch`/undici, sanitise provider error bodies before persisting them (some providers echo part of the received header back), and let the CI step that greps a full run's logs for the test key prefix fail the build if it finds anything. |

The rule generalises: a dependency that can hold, log, serialise or transmit a
provider credential needs an explicit review in its pull request, and "it is
popular" is not that review.

## Adding a software dependency

A pull request that adds or materially updates a dependency records:

1. package name, source, resolved version, and purpose;
2. license, plus any transitive or prebuilt binary components (native modules
   need a per-platform note);
3. whether it runs at build time, in CI, or in the request path with user data;
4. **whether it can ever see a provider key, an image byte, or a money value** —
   and if so, what stops it from writing any of them to a log;
5. why the standard library or an existing dependency is not enough;
6. which layer may import it, and whether `dependency-cruiser` already enforces
   that boundary.

Lockfiles are regenerated with repository tooling. A green dependency-review
check does not replace license or architecture review.

## Third-party AI providers

Prumo integrates thirteen image-generation providers: **fal.ai, Replicate,
KIE.ai, WaveSpeed, Runware, OpenAI, Google (Gemini), Black Forest Labs (FLUX),
Together, Novita, DeepInfra, Fireworks and Segmind.**

They are services, not dependencies, and the relationship is deliberately thin:

- **The contract is between the user and the provider.** The user opens the
  account, gives the provider a payment method, accepts that provider's terms
  and acceptable-use policy, and pastes the resulting key into Prumo. Prumo
  forwards that key on the user's behalf and nothing else.
- **Prumo never resells anything.** No margin, no markup, no pooled key, no
  Prumo-owned account in the request path. Money moves from the user's card to
  the provider; Prumo only records what it cost.
- **Prumo is a custodian of a third party's paid key.** Keys are stored
  encrypted (AES-256-GCM envelope, DEK per credential, KEK in `PRUMO_KEK`), and
  **whoever hosts the instance can decrypt them** — including the owner of the
  official instance. This is trust in the operator, not secrecy from the
  operator, and it is stated on the key-entry screen, not buried here.
- **No route ever returns a key**, not even masked. The interface shows the last
  four characters and the last verification date.
- **Content, model licenses and usage policies are the provider's.** What a
  model may be used for, whether its output may be sold, and what happens to an
  uploaded image are questions Prumo answers with a link to that provider, never
  with a promise of its own. Google's Gemini watermarks every image with SynthID
  — invisible, non-removable, not optional — and OpenAI requires organisation
  verification with a government document and facial recognition. Neither is
  something Prumo can waive.
- **Listing a provider is not endorsement, and delisting is a normal event.**
  Fireworks deprecated image generation on 2026-06-10 while its route kept
  answering `401`, which is why `provedor.ativo` exists and why a health check
  must distinguish "route alive" from "model exists".

## Price data provenance

The catalogue is licensed CC BY 4.0 — see [LICENSE-DATA](LICENSE-DATA) for what
that covers and how to attribute it. This section is about where the numbers
come from.

- **Source.** Public provider documentation and public pricing pages, read by a
  person or with AI assistance and then reviewed. Nothing is scraped from behind
  a login, and no provider's documentation is republished — the catalogue stores
  the number and links back to the page.
- **Every row carries its own provenance.** The `preco` table has `fonte` (URL),
  `coletado_em` (timestamp) and `metodo` (`doc`, `medido`, `estimado`) as
  **required columns**, and the table is append-only: a row is never edited, only
  closed with `vigente_ate`. A price without a source is treated as unverified
  and cannot be offered as "the cheapest route".
- **Staleness expires by itself.** A row older than 30 days drops out of the
  automatic ranking, and the screen shows the stamp. This is the mitigation for
  the failure mode that actually threatens this product: a catalogue that rots
  keeps working while it _lies_.
- **Prices are formulas, not floats.** DeepInfra bills
  `$0.009 x (w/1024) x (h/1024) x (iters/25)`; Together bills FLUX1.1[pro] per
  megapixel and schnell per image; BFL charges the first megapixel and adds the
  rest. The formula is a closed discriminated union with numeric parameters,
  evaluated by a pure function — never an interpreted expression, never `eval`.
- **Receipts outrank documentation.** When a provider returns a real cost after
  a real generation, that value corrects the catalogue and is recorded with
  `metodo = medido`. Where no such value exists — Replicate publishes no billing
  API — the ledger is marked `estimado` for good, and the interface says so.
- **Current honesty statement:** the survey in `docs/PROVEDORES.md` was
  collected on **2026-08-24 from documentation only**. No provider was called
  with a real key, no invoice has been reconciled, and lines marked
  `NÃO VERIFICADO` are exactly that. None of it is a measurement yet.

### Correction and removal

A provider — or anyone — who finds a wrong price, a stale row, or content they
want removed: open an issue at <https://github.com/Navesz/prumo/issues> with the
price-correction template, or write to `leonardonavesworking@gmail.com`.
Identify the rows. They are corrected or pulled from the published catalogue
first and discussed afterwards, because a wrong price inside a tool that routes
spending damages the provider more than a missing one does.

## Papers, prior art, and generated text

Ideas and published results are cited where they are used and, when relevant, in
[CITATION.cff](CITATION.cff). Source, figures and datasets are not copied merely
because they are reachable. Text produced with AI assistance is reviewed by a
person before it becomes a fact shown on screen — every price, model license and
usage policy included.

## Release notices

Before each public release, maintainers:

- compare manifests and lockfiles against this document;
- generate and review a dependency license inventory, including the native
  obligations of `sharp`/libvips;
- ship the required license and attribution texts inside the distributed
  artefacts, `LICENSE-DATA` among them when the catalogue is bundled;
- confirm the vendored `ferramental/` matches its `alicerce` origin, or that the
  divergence is recorded;
- confirm every catalogue row still carries `fonte`, `coletado_em` and `metodo`.
