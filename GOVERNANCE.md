# Governance

Prumo is a maintainer-led project that intends to move toward shared stewardship as the contributor community grows. Governance here favors written technical records, reproducible evidence, and reversible decisions.

Two facts shape every rule in this file. Prumo **holds third-party paid API keys**: whoever hosts an instance can read the keys of its users, so decisions about the vault are decisions about other people's money. And Prumo **publishes prices that people act on**: a wrong number does not crash anything, it makes the comparator recommend the wrong route with confidence. Neither of those is a routine change.

## Project status

M0 and M1 are under construction; no product feature exists yet. Everything below already applies — the point of writing it now is that the first money-related decision does not get made in a pull-request comment thread.

## Roles

### Contributor

Anyone who reports an issue, corrects a price with a source, improves documentation, reviews a change, or contributes code. There is no minimum activity requirement.

### Reviewer

A contributor trusted to review a defined area: provider adapters, the vault and cryptography, money and the ledger, the price catalog, database and concurrency, frontend and accessibility, or documentation. Reviewers give consistent, constructive review, know what evidence their area demands, and disclose conflicts of interest.

### Maintainer

A contributor trusted to triage issues, merge pull requests, manage releases and repository settings, answer security reports, hold the credentials of the official instance, and enforce community policy. Maintainers are responsible for the health of the whole project, not only their specialty.

The repository owner is the initial maintainer. New reviewers and maintainers are invited after sustained, constructive participation; nominations are discussed openly when privacy and security allow, and active maintainers decide by consensus. Access is removed after a documented request, prolonged inactivity, credential compromise, or a serious policy violation.

**Maintainer access to a hosted instance is access to users' paid keys.** Anyone with production access to the official instance is named publicly, because a custodian nobody can name is a custodian nobody can hold responsible.

## Decision process

Routine, reversible changes are decided in pull-request review. Maintainers seek consensus and explain what they ask for. When consensus is not reachable, the repository owner decides and records why.

Evidence beats preference, and the repository's marks are part of the record: ✅ proven · 🧪 decided but not measured · 🔴 blocks code. A claim about price or provider behavior needs a source URL and an access date. A claim about behavior under concurrency needs a test that reproduces it. Popularity does not override a missing source, a failing test, an incompatible license, or a threat model that got worse.

### Changes that require an ADR before merge

Open an issue or discussion, then add a numbered ADR under `adr/` with context, decision, alternatives considered, and consequences. These changes do not merge without one:

1. **The money format or the price calculation.** The unit is an integer in nano-USD (`bigint`, 1 = 1e-9 USD). Changing the unit, the rounding, the direction of rounding, or how a `preco` formula is evaluated changes every number the product has ever shown.
2. **Anything that changes when the user is charged.** Reservation, settlement, refund, retry policy, the handling of `duvida_de_cobranca`, or the moment a generation counts against the ceiling. If a change moves money earlier, later, or twice, it is in this list.
3. **The key vault or the threat model.** The envelope scheme, the AAD, KEK providers, rewrap, key verification, what the UI reveals, or anything that widens what an operator or a compromised host can reach. Also any change to the written statement that whoever hosts can read users' keys — that sentence is a product decision, not copy.
4. **Incompatible changes to the public catalog schema.** Provider slugs, model ids, the price `base` enum, the formula union, the `fonte`/`coletado_em`/`metodo` columns, and the exported catalog format. Third parties consume this; renaming a field silently breaks them.
5. **Removing a provider.** Removal deletes a route people priced their work around, and it is not the same decision as `ativo=false`, which is an operational switch a maintainer may flip alone when a provider breaks or deprecates image generation.
6. **License changes and privacy defaults.** Apache-2.0 for code, CC BY 4.0 for catalog data; what is logged, what is retained, what leaves the server, and what is sent to a third party on the user's behalf.
7. **The outbound destination list.** Adding a host that the server will call with a user's key. There is no `base_url` column precisely so this decision cannot be made by writing a row.
8. **Boundary rules and the vendored tooling.** Changing a `dependency-cruiser` rule, or diverging `ferramental/` from upstream `Navesz/alicerce`. A local divergence has to justify losing resynchronization.
9. **The deployment shape.** Splitting the single binary, adding a required service, or changing what `docker compose up -d` brings up. The single-process design is a deliberate trade recorded in `PLANO.md`.
10. **Adding a runtime dependency to `dominio/`**, which runs under a total denylist with named exceptions.

An ADR normally stays open for community feedback for at least seven days. A security fix, an actively harmful release, or a provider deprecation that is losing users' money may use an expedited decision, with the rationale published once disclosure is safe.

An ADR that is superseded is not deleted or edited into agreement with the present. It is marked superseded and points at the ADR that replaced it.

## Pull-request authority

- An author's self-review is not independent approval when another active maintainer exists.
- Non-trivial changes expect at least one maintainer approval. During the single-maintainer bootstrap period, the owner may merge after CI passes and the pull-request checklist is complete.
- Changes to money, the vault, the retry table, or an adapter's `mapError` should also be reviewed by someone familiar with that area once such a reviewer exists.
- Required CI, unresolved blocking conversations, and required ADRs must be complete before merge.
- A maintainer may merge a narrow, urgent security fix under embargo and document it after coordinated disclosure.
- **No pull request from a fork gets repository secrets**, and `pull_request_target` is not used. This is not negotiable per-PR: it is the difference between a public repository and a credential giveaway.

Branch protection should enforce these rules technically wherever the hosting plan allows.

## Evidence rules specific to this project

- A price entering the catalog carries `fonte`, `coletado_em` and `metodo`. A price without a source is not merged, and no maintainer may add one by exception.
- `metodo: medido` means a real generation was run and a real cost was read. Replicate publishes no billing API, so Replicate numbers are `estimado` — permanently, and the interface says so.
- A provider adapter merges only with sanitized fixtures captured from real responses. A contract test against invented responses proves nothing about the provider.
- No decision may present the ledger's `estimado` origin as if it were `exato`. Selling an estimate as a fact destroys trust in every number the platform shows, not just that one.
- Performance and concurrency claims need a reproducible test, not a description of the design.

## Conflicts of interest

Reviewers and maintainers disclose financial, employment, or affiliation interests that could reasonably influence a decision — in particular any relationship with one of the providers Prumo prices or routes to.

A person with a material conflict recuses themselves from decisions about that provider's ranking, pricing, removal, or adapter, whenever another qualified reviewer is available. Sponsorship, referral credit, or affiliate revenue from a provider is disclosed in the repository; a comparison tool whose ranking can be bought is worth less than no comparison tool.

## Releases and compatibility

Stable releases follow Semantic Versioning. Code is Apache-2.0; the price catalog is CC BY 4.0 and versioned with the release that ships it. A catalog schema change that breaks consumers is a breaking release, even when no code changed.

No number is published as measured without the evidence attached, and no milestone is announced as done before its proof passes.

## Changes to governance

Governance changes use the same public issue, pull-request, and ADR process as any other high-impact change. The history of this file is the authoritative record.
