## Problem

<!-- What is wrong or missing, and who it hurts. Link the issue with "Closes #123". -->

## Approach

<!-- The design, the tradeoff you accepted, and the alternative you rejected and why. -->

## How this was checked

<!--
Exact commands, fixtures, and output. "Tested locally" is not evidence.
If a claim has a number in it, say where the number came from.
-->

- [ ] `npm run verificar` passes on this branch — all steps, not one step
- [ ] Automated tests cover the failure path, not only the happy path
- [ ] Anything about concurrency, latency or throughput is marked 🧪 unless it
      was measured; the measurement is in this PR

## Gates

- [ ] **Any new rule ships with a planted violation proving it fails.** A rule
      without a case that it must reject is not a gate. The `dominio-puro` rule
      in Herz reported "no dependency violations found" for months with React
      inside the domain. New case added to `ferramental/portao/provar-portao.mjs`
      and `node ferramental/portao/provar-portao.mjs` passes.
- [ ] No rule was moved to `warn`, skipped, or suppressed. If it was, the
      suppression carries a written reason on the same line and is listed here.

## Keys and secrets

Prumo holds third-party paid API keys. A key leaked here spends someone else's
money before anyone notices.

- [ ] No real key in fixtures, tests, snapshots, recorded HTTP, `.env.example`,
      screenshots, or the PR body. Synthetic values only — real key format,
      not a real key
- [ ] No new code path logs, serializes, or returns a provider request/response
      without sanitizing it first; provider errors sometimes echo the header
      they received
- [ ] **No `axios`**, direct or transitive. Its error object carries
      `config.headers`, so one `console.error(err)` in a rare branch publishes a
      user's key to the log. HTTP client is `fetch`/undici
- [ ] No route reveals a stored credential, including masked, including
      "just the prefix", including behind an admin flag. The UI shows
      `ultimos4` and `verificada_em`
- [ ] Outbound destinations still come from the closed list in code — no
      endpoint read from the database, from user input, or from a provider
      response

## Money, price, and the ledger

- [ ] Money stays `bigint` in nano-USD (1 = 1e-9 USD). No float, no cents, no
      `Number` on the way through
- [ ] **Anything touching money, price, or the budget ceiling has an ADR** in
      `adr/`, linked here
- [ ] The ceiling is still enforced by a conditional `UPDATE` in the database
      — zero rows affected means the ceiling was hit. No read-then-check
- [ ] `preco_snapshot` is still written by value. Referencing `preco_id` would
      let a catalog update rewrite spend history retroactively, with nothing red
- [ ] New price rows carry `fonte`, `coletado_em` and `metodo`
- [ ] `lancamento` is still append-only, with `origem` (`exato` / `derivado` /
      `estimado`) visible wherever the number is shown. Selling an estimate as a
      fact is the one failure that discredits the whole platform
- [ ] The reconciliation `orcamento.gasto_nano == SUM(lancamento)` still returns
      zero rows, and still runs as a test assertion rather than a dashboard

## Schema

- [ ] No schema change; **or** a migration is included, with a working `down`,
      and `docs/ESQUEMA.md` updated in the same PR
- [ ] The migration is safe to run twice and safe to run while an old process
      is still up — migration runs at boot under an advisory lock
- [ ] RLS policies still cover the new or changed table, and the isolation test
      (user A reaches nothing of user B) still passes

## Providers

- [ ] Provider behavior asserted here comes from official documentation with a
      URL and an access date, or is marked as unverified
- [ ] Failure states stay distinct: `falhou`, `moderada` and
      `duvida_de_cobranca` do not collapse into "error"
- [ ] Read timeout against a provider without idempotency support still does
      **not** retry — it becomes `duvida_de_cobranca`
- [ ] Nothing is reported as ready before the bytes are in Prumo's own storage.
      A BFL output URL lives 10 minutes

## Documentation and release note

- [ ] `CHANGELOG.md` updated, or this change has no user-visible effect
- [ ] Portuguese documents (`PLANO.md`, `docs/ESQUEMA.md`,
      `docs/PROVEDORES.md`, `README.pt-BR.md`, `.ai/`) and English documents
      still agree with each other and with the code
- [ ] No document now implies a feature works today that does not. Prumo is at
      M0/M1: no product functionality exists yet

## Evidence

<!-- Sanitized logs, screenshots, query plans, timings, migration output. -->
