# Changelog

All notable changes to Prumo are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been tagged and no product feature works. What exists is the
decided architecture and the toolchain that will refuse a bad commit. M0
(foundation and gate) and M1 (empty vertical skeleton) are the milestones under
construction; nothing below describes running behaviour.

`CITATION.cff` carries `0.1.0` as the version to cite for the repository in this
pre-release state. The first tagged release is cut when M1's acceptance proof
passes, and it gets its own section here.

### Added

- Build plan (`PLANO.md`): one Node binary serving HTTP, worker and SSE selected by `PRUMO_PAPEL`; two compose services; money as integer nano-USD; the spending ceiling enforced by a conditional `UPDATE` instead of a prior check; the queue ordered by deadline rather than arrival, because a FLUX output URL lives ten minutes and a late worker loses an image that was already paid for.
- Database design (`docs/ESQUEMA.md`): 21 tables, with the reasoning for the six that carry the architecture — `orcamento`, `slot_provedor`, `tarefa`, `geracao`, `lancamento`, `credencial_provedor` — including why `CHECK (gasto + reservado <= teto)` is forbidden and why the vault's AAD is recomputed rather than stored.
- Provider survey (`docs/PROVEDORES.md`): thirteen providers read against their official documentation on 2026-08-24, with auth header, mode, cost-on-response, output lifetime, rate limits, traps and sources per provider. Documentation reading only — no provider was called with a real key, and unconfirmed lines are marked as such.
- Vendored `ferramental/`, copied from `Navesz/alicerce`: `verificar` (the single command that decides whether a task is done), `fronteiras` (layer rules with a planted violation proving each one fails), `segredo` (credential scan over tracked files), `elos`, `portao` and the git hooks. Plain Node, zero dependencies, names kept in Portuguese so it can be resynchronised with its origin.
- Licensing and provenance: Apache-2.0 for the code (`LICENSE`), CC BY 4.0 for the price catalogue (`LICENSE-DATA`), the dependency and service boundaries in `THIRD_PARTY.md` — which records `axios` as prohibited, the thirteen providers as the user's own contracts, and the correction channel for a wrong price — and `CITATION.cff`.

### Not yet true

Everything the product is for. Before the first tag, M0 has to make
`npm run verificar` complete in under two minutes and prove it fails on a
planted error and a planted boundary violation, with branch protection,
gitleaks and Dependabot on; then M1 has to bring `docker compose up -d` in three
commands, migrations on boot under an advisory lock, a boot that refuses to
start while naming the missing variable, a ts-rest contract typing both ends
with response validation on, and row-level security with a passing isolation
test where tenant A reaches nothing of tenant B.

[Unreleased]: https://github.com/Navesz/prumo/commits/main
