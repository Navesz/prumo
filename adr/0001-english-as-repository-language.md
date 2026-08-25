# ADR 0001: English as the repository language

- Status: Accepted
- Date: 2026-08-24

## Context

Prumo is a public repository (github.com/Navesz/prumo) whose central asset rots on a schedule. Every row of the price catalogue carries `source`, `collected_at` and `method`, and drops out of the ranking automatically after 30 days. Thirteen providers, each with its own billing base — per image, per megapixel, per step, per second, per output token — is permanent manual maintenance disguised as a table. The plan says so in the risk list: when the catalogue rots, the product keeps working while it lies, which is the worst failure mode available.

That maintenance only survives if strangers can do it. A stranger who cannot read `preco.vigente_ate` will not open a pull request correcting a price, and the correction is a two-line diff — the cheapest contribution the project will ever receive. Losing it to a language barrier is losing it for nothing.

The house standard says the opposite. Alicerce invariant 23 is "Um idioma só no repositório" — one language only in the repository — justified as: mixing languages is the silent source of duplicate names, and a duplicate name is what makes an AI write the second implementation of something that already exists. Herz applies it as Portuguese for the domain and English for the technical vocabulary, revised on 2026-08-21 after the previous, stricter version was found to be violated by the code itself (`Provider`, `Query`, `UnitOfWork`).

There is a mechanical lesson underneath, and it is the reason this ADR is not only about prose. Herz named its React hooks `usarComando`, `usarSessao`, and so on. The oxlint rule `react-hooks/rules-of-hooks` identifies a hook by the `use` prefix, with no option to configure it. The rule therefore matched nothing across 24 files; the three errors it did report were false positives; and `lint` was never wired into `verificar` at all, so nobody noticed. **A name the tool does not recognize turns the tool off, silently.** No error, no warning, a green check.

## Decision

Everything a compiler, a linter, or a stranger reads is in English:

- TypeScript identifiers, file names and directory names under source;
- SQL identifiers — tables, columns, enum values, index names, migration file names;
- environment variable names;
- HTTP paths, contract field names, and the stable `type` URIs of Problem Details (RFC 9457);
- test names, commit subjects, branch names, issue and pull request titles and bodies;
- code comments;
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md`, this `adr/` directory, and `docs/` in general.

Portuguese survives in exactly these places, and the list is closed:

| Path                 | Why it stays Portuguese                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `PLANO.md`           | The owner's own construction plan, written to be reasoned in, not contributed to |
| `docs/ESQUEMA.md`    | Schema rationale written before this ADR; see the debt below                     |
| `docs/PROVEDORES.md` | Provider research, 13 providers with sources and traps                           |
| `README.pt-BR.md`    | The Portuguese half of the two-README pattern taken from OpenKartLine            |
| `.ai/`               | Agent context layer, single source generating `CLAUDE.md` / `AGENTS.md`          |
| `ferramental/`       | Vendored from a private repository; see ADR 0002                                 |

The pt-BR user interface is not an exception, because it is not code. UI strings live in one module: keys in English, values in Portuguese. A translator touches values; nobody greps for a value.

Technical vocabulary follows community convention, which is the conclusion Herz already reached the hard way: `repository`, `middleware`, `handler`, `request`, `transaction`, `UnitOfWork`, `useCommand`. Not because English is better, but because a model has seen billions of examples of `repository` and almost none of `repositorio`, and because translating a term of the trade spends context explaining what the convention already says.

**No identifier may use a prefix or suffix that a configured tool matches on, in any language other than the one that tool expects.** React hooks are `useX`. This rule has teeth at M0: the gate plants a hook named `usarX` containing a rules-of-hooks violation, and `npm run verificar` must fail on it. A rule with no planted violation is not a gate; it is a hope.

### The Portuguese identifiers that exist today

`docs/ESQUEMA.md` names 21 tables in Portuguese — `orcamento`, `geracao`, `tarefa`, `slot_provedor`, `lancamento`, `credencial_provedor`, `preco`, `lote`, `imagem`, `comando_processado` — and `PLANO.md` uses `PRUMO_PAPEL`. Both documents predate this ADR. This ADR fixes the resolution, and M1 pays it:

`orcamento` → `budget` · `geracao` → `generation` · `tarefa` → `task` · `slot_provedor` → `provider_slot` · `lancamento` → `ledger_entry` · `credencial_provedor` → `provider_credential` · `preco` → `price` · `lote` → `batch` · `imagem` → `image` · `comando_processado` → `processed_command` · `PRUMO_PAPEL` → `PRUMO_ROLE`, values `api|worker|all`.

`docs/ESQUEMA.md` stays in Portuguese and carries the English name of each table in its heading. A Portuguese document describing tables that do not exist under those names is exactly the failure Herz names: a guide that describes the wrong code is worse than no guide, because the AI follows the description and writes against reality, confidently.

## Consequences

- The stranger path works end to end. An issue titled "flux-2-pro price is stale since 2026-06" and a diff on `price` rows is readable and reviewable without Portuguese.
- Linters, code generators and models operate in the vocabulary they were built for. The hooks rule matches. `dependency-cruiser` path patterns read the same as every example on the internet.
- The divergence from Alicerce invariant 23 is bounded and per-file, not per-word. The invariant's real content — one name per concept — is preserved, because a concept never appears in both languages inside code.

### What we give up

- The owner writes and reviews in his second language, permanently. Every commit message, every error string, every code comment costs more to write, and the wording of a Problem Details `detail` will be blunter than it would have been in Portuguese.
- Two documents now describe the same schema in two languages: `docs/ESQUEMA.md` in Portuguese and the migrations in English. That is a genuine duplicate, and duplicates drift. The intended guard is the best idea in Herz — a test that derives facts from the code and requires the documentation to contain them. **That test does not exist yet.** Until it does, the drift is unguarded and this ADR is the only thing pointing at it.
- Grepping for a concept sometimes needs two words (`orcamento` and `budget`) for as long as `PLANO.md` lives.
- We lose the cheapest rule in the set: "everything here is Portuguese" needed no exception list, no table, and no ADR. This one needs all three, and an exception list is a thing that grows when nobody is looking.
- Renaming the tables at M1 is real work that produces no user-visible change, done at the exact moment when there is the most pressure to build features instead.

## Reconsider if

Twelve months after the repository is opened to external users (M9), fewer than **3 pull requests from non-owner accounts** have merged touching `price` rows or provider adapters — measured with `git log --no-merges --format='%an %s' -- src/providers docs/prices` and excluding Navesz. That would mean English bought no contributors and the cost is pure. In that case keep the English identifiers, because renaming them costs a migration, and move the prose documents to Portuguese.

Reconsider the _exception list_ separately if it ever exceeds these six entries. A seventh exception is evidence that the rule is not the rule.
