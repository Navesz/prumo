# Contributing to Prumo

Prumo is a self-hosted image-generation platform where the user pastes their own provider API keys, fires one prompt at several models at once, sees the cost of each image before spending it, and runs under a ceiling the database enforces. Contributions are welcome in English or Brazilian Portuguese.

## Read this before picking a task

M0 is done and M1 is standing. **No product feature exists yet.** The repository has a
workspace, a typed contract, one migration, an account with a session, row level
security and a spending cap the database enforces — and **no provider adapter and no
generation**. Nothing produces an image today.

What exists is the plan ([PLANO.md](PLANO.md)), the database design ([docs/ESQUEMA.md](docs/ESQUEMA.md)), the provider survey ([docs/PROVEDORES.md](docs/PROVEDORES.md)), and the vendored tooling in `ferramental/`. Until M0 closes, the contributions that can land are documentation, the verification gate, provider research with sources, and price research with sources. The commands below describe the contract M0 has to satisfy; several of them do not run yet, and saying otherwise would make this file the first thing in the repository that lies.

## Language

Code, API fields, commit messages, issues, pull requests, and documentation are in **English**. Five things are in Portuguese on purpose: `PLANO.md`, `docs/ESQUEMA.md`, `docs/PROVEDORES.md`, `README.pt-BR.md`, and `.ai/`.

Two directory trees also keep Portuguese names, and neither is an oversight. `ferramental/` is vendored from the private `Navesz/alicerce` and keeps upstream's names so it can be resynced; rename a file there and the next sync becomes a manual merge. The layer directory names are the ones the dependency-cruiser preset matches on; rename a layer and the boundary rules stop matching it without reporting anything. A name the tool does not recognize turns the tool off silently.

## Find the right place

- [GitHub Discussions](https://github.com/Navesz/prumo/discussions) for questions, ideas, and design conversations.
- Issue templates for a reproducible bug, a scoped feature, a **price correction**, or a **new provider**.
- [SECURITY.md](SECURITY.md) for anything exploitable. Never in a public issue.
- [SUPPORT.md](SUPPORT.md) if your problem is with a provider's billing, credits, verification, or moderation. Prumo is not their support desk.

Small fixes can go straight to a pull request. Open an issue first for anything that touches money, the vault, the catalog schema, or a provider adapter — those need agreement before code, and several of them need an ADR before merge ([GOVERNANCE.md](GOVERNANCE.md)).

## Run it

```bash
git clone https://github.com/Navesz/prumo.git
cd prumo
docker compose up -d     # two services: prumo + postgres:17-alpine
npm ci
npm run verificar
```

There is no separate migration step: migrations run at boot under a Postgres advisory lock. The boot refuses to start when a required variable is missing and names the variable, so the fastest way to find out what you need is to let it tell you.

Generate a development KEK:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

`PRUMO_KEK` decrypts every stored credential in that instance. A development KEK never travels to a real instance, and losing a real instance's KEK is irreversible — the credentials are unreadable, not recoverable. Keep the KEK copy somewhere **other** than the database backup; the two stored together are the entire vault in one folder.

`PRUMO_PAPEL=api|worker|tudo` selects what the single Node binary runs. `tudo` is the development default.

## The gate

`npm run verificar` runs the declared steps in increasing order of cost and stops at the first group that fails. **Fix the first failing step**, not the noisiest one — fixing it usually clears everything below it.

| Step         | Command                                       | A failure means                                                                      |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `formato`    | `prettier --check .`                          | nothing of yours is at stake; run `prettier --write .`                               |
| `lint`       | `oxlint`                                      | a rule fired; read the rule name before arguing with it                              |
| `tipos`      | `tsc -b`                                      | a shape disagreement; start at the first file listed                                 |
| `fronteiras` | `depcruise src`                               | an import crossed a layer; the violated rule name is at the end of the line          |
| `segredo`    | `node ferramental/segredo/varrer-segredo.mjs` | a credential is in something Git tracks; a new commit does not fix it, rotation does |
| `testes`     | `vitest run`                                  |                                                                                      |
| `build`      | `npm run build`                               |                                                                                      |

Run one step with `npm run verificar -- --passo=tipos`. The gate has to pass locally before a pull request; CI runs the same steps, and a fork's workflow gets no secrets.

Boundary rules worth knowing before you write an import:

- `provedores/` must not import `db/` or `dominio/`.
- `dominio/` and `app/` must not import an HTTP client, an S3 client, or `node:fs`. This is what turns "no external I/O inside a transaction" into a tool instead of a paragraph.
- `dominio/` uses a **total denylist of `node_modules` with named exceptions**, not an allowlist. An allowlist by name is how a previous project of this owner shipped a rule that printed "no dependency violations found" for months with React inside the domain layer.
- Every rule ships with a planted violation proving it fails. A gate that has never fired may be broken. New rule, new proof under `ferramental/fronteiras/provas/`.

## Engineering rules

These are the ones where being wrong costs somebody money.

- **Money is an integer in nano-USD** (`bigint`, 1 = 1e-9 USD). Never a float, never cents — there are images at US$ 0.0005 and cents truncate the product. A float anywhere in a money path is a blocking review comment, not a nit.
- **No HTTP call inside a database transaction.** Transaction opens, calls fal, deadlocks, retries — and calls fal again. Two images, two charges. External effects have no rollback.
- **`axios` is banned in the whole project**, dependencies, devDependencies, and examples alike. Its error object carries `config.headers`, so one `console.error(err)` in a rare branch publishes a user's paid API key into the log. Use `fetch`/undici.
- **The spend ceiling is enforced by a conditional `UPDATE`**, never by check-then-write. Zero rows affected means the ceiling was hit. Code that reads the budget, decides, and then writes is a bug even when it reads correctly, because eight models fired in the same millisecond pass the check together.
- **No `base_url` in data.** Outbound destinations are a closed list in code. The server makes an authenticated request with the user's key, so any endpoint arriving from an editable row is a credential exfiltration route.
- **Nothing is "done" before the bytes are in Prumo's own storage.** A BFL output URL lives 10 minutes; Replicate deletes the whole prediction record, output included, after an hour.
- **Sanitize a provider error before storing it.** Some providers echo part of the header they received back in the message.
- **A price without `fonte`, `coletado_em` and `metodo` is not a price.**
- Mark uncertainty the way the rest of the repository does: ✅ proven · 🧪 decided but not measured · 🔴 blocks code. Presenting a 🧪 as a ✅ is the exact failure the marks exist to prevent.

## Correcting a price

A wrong price crashes nothing. It makes the comparator recommend the wrong route with total confidence, which is the worst failure this project can have — the product keeps working while it lies.

Open an issue with the **`price_correction`** template (`.github/ISSUE_TEMPLATE/price_correction.yml`). It requires:

- **provider slug and model id**, exactly as the catalog spells them (`fal:fal-ai/flux/schnell`, `runware:bfl:6@1`). A sub-endpoint is a different model, not a flag: `/inpainting` has its own price;
- **the official source URL** — the provider's own pricing or API documentation page. A blog post, a comparison site, a screenshot, a Discord message, or an LLM answer is not a source;
- **the date of access**, in UTC;
- **the billing base**: `por_imagem`, `por_megapixel`, `por_passo`, `por_segundo`, `por_token_saida`, or `formula`, with its numeric parameters;
- **the method**: `doc` (read on the provider's page), `medido` (you ran a real generation and read the returned cost or the invoice), or `estimado` (derived — say from what).

**A price with no source does not enter.** Not "enters with a TODO". Does not enter.

Three things a reviewer will check:

1. **Price is a formula, not a float.** DeepInfra bills `$0.009 × (w/1024) × (h/1024) × (iters/25)`. Together bills FLUX1.1 [pro] per megapixel and schnell per image. BFL bills the first megapixel and adds the following ones. A single "USD per image" number for any of those is wrong for every request that is not exactly the reference size. If the per-image figure is all you can find, submit it as `estimado` and say why.
2. **`preco` rows are append-only.** A row is never edited: the old one is closed with `vigente_ate` and a new one is inserted. A pull request that edits a price in place erases the record of what the catalog believed when past generations were priced.
3. **`medido` means measured.** Replicate publishes no billing API, so every Replicate number is `estimado` forever; writing `medido` there is inventing. If you attach a receipt as evidence, sanitize it first — see the next section.

Anything older than 30 days leaves the automatic ranking by itself. A stale entry is not a bug report, it is a re-collection.

Catalog data is contributed under CC BY 4.0, not Apache-2.0. Record numbers, formulas, and links; do not paste a provider's pricing table verbatim.

## Adding a provider

Open an issue with the **`new_provider`** template before writing the adapter. An adapter is a permanent maintenance commitment: within the four-week window of the original survey, two of the thirteen providers changed or deprecated image generation, and one of them still answers 401 on a route that no longer generates anything.

An adapter implements eight methods and nothing else.

| Method                    | Does                                                                                                                                                                                                  | Must not                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe()`              | returns the provider's static facts: auth style, sync/queue mode, output TTL in seconds, webhook signature scheme, whether cost comes back on the response, whether the provider supports idempotency | invent a value nobody read in the provider's docs. `ttl_saida_seg` is the ingestion clock and `suporta_idempotencia` decides whether retry is allowed at all — both are architecture, not metadata |
| `resolveModel(id)`        | maps a catalog model id to a concrete endpoint and input schema                                                                                                                                       | assume one schema per model family. fal's `/inpainting` and `/image-to-image` have schemas different from the base endpoint                                                                        |
| `estimate(model, params)` | pure function: request parameters plus the `preco` row, out comes a cost in nano-USD                                                                                                                  | touch the network, the clock, or the database. It runs inside the reservation path, which runs inside a transaction                                                                                |
| `submit(...)`             | the paid call — the only method allowed to spend money                                                                                                                                                | run inside a database transaction, or take its destination host from data                                                                                                                          |
| `poll(...)`               | asks for status and schedules the next attempt with backoff 2→5→10→20 s                                                                                                                               | go below 2 s (WaveSpeed asks for this explicitly), or read "still running" as failure                                                                                                              |
| `materialize(...)`        | streams the output into Prumo's storage, hashing on the way                                                                                                                                           | assume the provider's URL will still resolve later. BFL gives 10 minutes; Replicate deletes the record after an hour                                                                               |
| `verifyHook(...)`         | verifies the webhook signature and returns the provider's request id for deduplication                                                                                                                | compare signatures in non-constant time, or accept a body it could not verify. fal redelivers up to 31 times, so every handler is idempotent by request id                                         |
| `mapError(...)`           | maps HTTP status plus body onto the closed error set the retry table understands: retryable, rate-limited, auth, no-credit, moderation, billing-doubt                                                 | carry the raw error object into the result. That is exactly how a request header reaches a log file                                                                                                |

`mapError` is where money is lost or charged twice. It has to reproduce these rules:

- **401 / 403 never retry.** Three in a row mark the credential invalid.
- **429** reschedules by `Retry-After`, does not count against the retry budget, and lowers the learned concurrency for that provider.
- **402** is "no credit": cancel the rest of the batch **on that provider only** and refund the reservation.
- **Moderation is terminal** and never retried. It arrives as HTTP 200 at BFL, as `error.code` at OpenAI, and as `FAILED` at Segmind.
- **A read timeout against a provider with `suporta_idempotencia=false` is not retryable.** It becomes `duvida_de_cobranca`. WaveSpeed states it in writing: a disconnected response can still correspond to a prediction that was accepted and billed. Calling that an "error" and letting the user click again converts a bug into a double charge.

**Fixtures are mandatory. An adapter without fixtures does not enter.** A contract test run against invented responses proves only that the adapter agrees with its author's imagination. Capture real responses — sanitized, see the next section — under `src/provedores/<slug>/fixtures/`, covering at minimum: accepted submit, in-progress poll, completed poll, moderation refusal, 401, 429 with its headers, and the provider's own error body.

The shared contract test runs the same suite against every adapter using its fixtures. A provider is finished when it passes, plus:

- a `provedor` row, including `auth_estilo` (the enum has five values because fal literally sends `Key <token>`, not `Bearer <token>`, and Google sends `x-goog-api-key`);
- one `modelo` row per endpoint, sub-endpoints included;
- one `preco` row per model, with source, date, and method;
- the destination hosts added to the closed outbound allowlist in code;
- an entry in `docs/PROVEDORES.md` — in Portuguese, with traps and source links;
- a test for any header combination that breaks the provider. Segmind returns 401 when `Authorization` and `x-api-key` arrive together, so any client that injects a global Bearer breaks it silently.

## Never paste a real API key

Not in an issue, a pull request, a test, a fixture, a log, a screenshot, a commit message, or a Discussion. Not even a "test key" — a test key on a real account spends real money, and the money is the key owner's, not the project's.

**Sanitizing a fixture before committing it:**

1. Capture with a script that strips headers, never by hand. Remove `Authorization`, `x-api-key`, `x-key`, `x-goog-api-key`, `Cookie`, and anything matching `*-signature`, `*-token`, or `*-secret`.
2. Replace the credential with a fixed, obviously fake placeholder — `sk-FIXTURE-NOT-A-REAL-KEY`. A truncated real key is still a real key prefix.
3. Strip query strings from CDN URLs. fal (`v3.fal.media`) and Replicate (`replicate.delivery`) hand out URLs that can carry an access token in the query, and a fixture that keeps one is a credential in a JSON file.
4. Remove account ids, organization ids, and email addresses. Provider request ids can stay — they are what makes the fixture traceable.
5. `grep` the diff for your own key's first eight characters before committing. `npm run verificar` runs the `segredo` step over what Git tracks, but that scanner is a net with a mesh size, not a proof. The only person who knows for certain that a key is in the diff is the person who pasted it.

**If you already pasted one, in this order:**

1. **Rotate the key at the provider, now.** Revoke the old one. This is the only step that actually stops the spending; everything after it is cleanup.
2. Check the provider's usage dashboard for spending you did not do, and their billing page if you find any.
3. **Do not try to erase the commit.** Force-pushing, deleting the branch, or editing the issue does not undo the exposure: GitHub retains the pre-edit body, forks and caches keep the blob, and mirrors keep the history. Replicate documents that it automatically scans public repositories for leaked tokens and disables them — assume someone else's scanner found it first.
4. Report it through [SECURITY.md](SECURITY.md) so maintainers can check whether the same value reached CI logs or artifacts.

Rewriting history is a decision for maintainers after the key is dead, not a first response by the person who leaked it. A rotated key in a public commit is an embarrassment; an unrotated key deleted from a commit is an open wallet.

## A test that calls a real provider is not a test, it is an expense

**In tests, the provider is always fake.** The adapter takes an injected `fetch`; the test supplies the fixture. There is no exception, not for "just one smoke test", not for "only on main".

Why it is a hard rule and not a preference:

- A suite that calls fal on every push is a subscription nobody agreed to pay.
- A retry loop bug inside a test can issue hundreds of paid calls in seconds with no human watching. The retry logic being tested is precisely the code most likely to have that bug.
- A live call makes the test depend on a third party's uptime, queue depth, and moderation mood, so it fails for reasons unrelated to your change — and a test that fails randomly teaches everyone to ignore the suite.
- Providers rate-limit per account. One contributor's live test can 429 another contributor's real work.

**No real secret reaches CI.** Workflows triggered by a fork receive no secrets; a pull request from a stranger with access to secrets is exfiltration in one commit. `pull_request_target` is not used in this repository. The test harness installs a `fetch` that throws on any host outside the fixture table, so an accidental live call fails the suite instead of billing somebody.

CI also runs a full flow with a fake key of a known prefix and greps the resulting log for that prefix. If it appears, the build fails. That test exists because the failure it catches — a key in a log line — is invisible in review and permanent in a log archive.

If you genuinely need to observe a live provider (confirming a claim in `docs/PROVEDORES.md`, or turning an `estimado` price into `medido`), do it manually, on your own account, with your own money, and record the result as a dated fact with its method. That is a measurement. It does not run in CI, and it never becomes a test.

## Commits

Conventional Commits, imperative, in English:

```text
feat(cofre): rewrap credentials into a new KEK id
fix(provedores/fal): read cost from billing-events, not the header
fix(orcamento): keep the ceiling inside the conditional UPDATE
test(provedores/segmind): cover 401 when both auth headers are sent
docs(precos): record the DeepInfra formula with source and date
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`. Use `!` and a `BREAKING CHANGE:` footer for an intentionally incompatible change — and check [GOVERNANCE.md](GOVERNANCE.md) first, because most incompatible changes here need an ADR before merge.

Never put a key, a token, a KEK, or a real user's email into a commit message. Commit messages are as permanent as code and are not covered by the secret scanner.

Sign-offs are not required. By contributing you certify that you have the right to contribute the work, and agree that code is distributed under Apache-2.0 and catalog data under CC BY 4.0.

## Pull requests

A ready pull request explains:

- the problem and who it affects;
- the approach and the alternatives you rejected;
- exactly what you ran to validate it;
- effects on money (unit, rounding, when the user is charged), on the vault and its threat model, on the public catalog schema, on privacy defaults, and on licenses;
- for a price change: source, date, method;
- for an adapter: which fixtures are new and how they were captured and sanitized;
- screenshots for visible UI changes, and before/after numbers for any performance or cost claim.

Draft pull requests are welcome. Automated checks must pass before merge. Review looks at correctness under concurrency, what happens when the provider fails after charging, whether claims match evidence, and whether a number has a source.

## Review etiquette

Review the change, not the author. Mark blocking correctness, money, or credential concerns clearly and separate them from optional suggestions. Authors resolve conversations or explain why no change is needed. If a discussion turns out to be about a design decision rather than the diff, move it to an issue or an ADR under `adr/` so the reasoning stays findable.

## Recognition

Git history and release notes credit contributors. Sustained contributors can become reviewers or maintainers through the process in [GOVERNANCE.md](GOVERNANCE.md).
