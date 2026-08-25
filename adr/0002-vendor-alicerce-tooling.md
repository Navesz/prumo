# ADR 0002: Vendor the Alicerce tooling instead of depending on it

- Status: Accepted
- Date: 2026-08-24

## Context

The verification gate Prumo needs at M0 already exists in `Navesz/alicerce`: `verificar` (the single command that decides whether a task is finished), `fronteiras` (dependency-cruiser layer presets, each with a case it must reject and a case it must accept), `segredo` (credential scan over what Git tracks), `elos` (broken relative links in Markdown), `portao` (proof that the verification actually fails what it should), `hooks`, plus the `ci/verificar.yml` workflow template and the `.ai/` context layer.

**Alicerce is private. Prumo is public.** A public repository that depends on a private one fails three ways, all of them at the moment a stranger arrives:

1. `npm install` fails for everyone except the owner. A `git+ssh` dependency needs a key nobody else has, and a `git+https` dependency on a private repository needs a token that must never be in a public lockfile.
2. CI on a fork cannot fetch it. Fork-triggered workflows receive no secrets — that is a mandatory clause for a public repository, because a stranger's pull request with access to a secret is exfiltration in one commit. So the fork's CI cannot even reach the tool that decides whether the fork's CI passes.
3. The tree a contributor checks out is not the tree CI verified. The gate becomes unauditable precisely for the people the gate exists to protect against.

There is a fourth reason specific to this tooling. It is Node-only, zero-dependency by design: what checks the build must not depend on the build. Publishing it to npm would give it a build, a version resolution step, and a supply chain — three things it deliberately does not have.

## Decision

Copy the tree into `ferramental/` at the repository root and commit it.

**Keep the original Portuguese file and directory names, unchanged:** `verificar/verificar.mjs`, `fronteiras/api-camadas.cjs`, `fronteiras/provas/provar.mjs`, `segredo/varrer-segredo.mjs`, `elos/`, `portao/provar-portao.mjs`, `hooks/instalar.mjs`. Renaming them to English would make every future diff against upstream a rename diff, and a three-way merge across renames is where resynchronization dies. `ferramental/` is the single named exception to ADR 0001, and it is an exception for exactly this reason: the names are a merge key, not a style choice.

`ferramental/ORIGEM.md` records the upstream repository, the commit SHA the copy was taken from, and the date. Without it, "is this current?" has no answer.

**Local adaptation happens outside `ferramental/`.** The project's own configuration lives at the root — `verificar.config.mjs` (which steps this project has) and `.dependency-cruiser.cjs` (which layer preset, plus the three boundary rules Herz does not have: `providers/` must not import `db/` or `domain/`; `domain/` and `app/` must not import an HTTP client, S3 or `fs`; and the forbidden `node_modules` list in `domain/` is a total denylist with named exceptions, not an allowlist by name). Those are project files. Nothing inside `ferramental/` is edited in place. A change that belongs to the tool goes upstream first and comes back with the next resync — that discipline is the only thing that keeps resync possible at all.

`CONTRIBUTING.md` must state that pull requests modifying `ferramental/` are declined with a pointer to an issue, and why.

## Consequences

- `git clone && npm install && npm run verificar` works for anybody, on a fork, with no credentials.
- CI on a fork runs the same gate as CI on the main repository, from the same bytes.
- The gate is auditable: a reviewer reading a pull request can see the tool that judged it.
- Zero runtime dependency added, which is the point of the tooling being Node-pure.

### What we give up

- Upstream fixes do not arrive with `npm update`. They arrive when somebody re-copies, and nobody re-copies. The vendored tree will drift stale, and a stale _verification_ tool means the gate is quietly weaker than the one Alicerce ships — the failure is invisible by construction, because a weaker gate still prints green.
- Duplicated code across the owner's repositories, with the usual result: a bug fixed in one copy stays alive in the other.
- A Portuguese command name (`npm run verificar`) is the first thing an English-speaking contributor meets in an English repository. That is a real onboarding cost, paid deliberately, and ADR 0001 does not get to pretend otherwise.
- A stranger who finds a bug in `varrer-segredo.mjs` has nowhere to send the fix, because Alicerce is private. They can only patch the copy — which is precisely what this ADR forbids. The honest description is: for this directory, external contribution is closed.
- If Alicerce ever changes a preset's semantics, Prumo's `.dependency-cruiser.cjs` may be configured against a contract that no longer exists upstream, and the mismatch surfaces only at the next resync, as a pile of new violations at once.

## Reconsider if

- `ferramental/ORIGEM.md` shows the recorded upstream commit is more than **90 days** behind the Alicerce `main` at two consecutive Prumo releases. That is measurable proof that the resync ritual is not happening, and the answer is either to schedule it or to accept the fork as permanent and delete the pretence of resynchronization.
- **3 or more distinct issues** are opened by non-owner accounts against files under `ferramental/`. That is evidence the vendored Portuguese tree is a live contribution barrier, not a theoretical one, and the tooling should be extracted into a published package with English entry points.
- Alicerce becomes public. Then a submodule pinned to a SHA, or a published package, is available and this ADR is superseded — with the note that a submodule reintroduces "the tree I checked out is not the tree CI verified" unless the SHA is pinned and verified in CI.
