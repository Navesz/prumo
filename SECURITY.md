# Security policy

Prumo is a custodian of paid third-party API keys. A user pastes a fal.ai, Replicate, OpenAI, BFL, Runware, WaveSpeed, KIE.ai, Google, Together, Novita, DeepInfra or Segmind key, and from that moment the server holds a credential that spends that person's money. That single fact is why this document is longer and blunter than the security policy of a normal pre-1.0 project.

> **Whoever operates a Prumo instance can read the provider API keys of every user on that instance.**

That sentence is not softened anywhere. It is the same sentence that appears on the key-registration screen inside the product — shipping that screen without it is a release blocker, not a copy decision. Prumo is a vault whose security property is _trust in the operator_, not secrecy from the operator. If you cannot accept that about an instance, do not paste a key into it; run your own.

## Project status, so you know what this policy is describing

Prumo is at **M0/M1 (foundation and empty vertical skeleton)**. No product feature exists yet: there is no account system, no vault, no generation, no gallery. `PLANO.md` is the source of truth for what is decided; `docs/ESQUEMA.md` and `docs/PROVEDORES.md` are the schema and the provider survey.

Everything this document calls "enforced" is a specification with the milestone that delivers it named. None of it is guarding a running system today, because there is no running system. The marks used throughout the repository apply here too:

- ✅ proven — measured, or a test fails when it is violated
- 🧪 decided but not measured
- 🔴 blocks code — an open question that stops work until answered

## Supported versions

There is no stable release. Fixes land on `main` and, once one exists, on the most recent tagged pre-release. Older pre-releases are asked to upgrade rather than backported. This table becomes version-specific at 1.0.

| Version                   | Supported           |
| ------------------------- | ------------------- |
| `main`                    | Best effort         |
| Latest tagged pre-release | Yes, once published |
| Older pre-releases        | No                  |

## Report a vulnerability privately

Do not open a public issue for an exploitable vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/Navesz/prumo/security/advisories/new). Include, when possible:

- affected commit or tag, and `PRUMO_PAPEL` / `PRUMO_MODO` of the affected deployment;
- impact and a realistic attack scenario, naming the trust boundary crossed;
- minimal reproduction or proof of concept;
- whether the issue can reach `credencial_provedor`, `PRUMO_KEK`, the fingerprint pepper, the session table, or the outbound request path — these are ranked above everything else;
- suggested mitigation;
- whether and where the issue has already been disclosed.

### Never put a real API key in a report

Not in a curl command, not in a log excerpt, not in a screenshot, not in a HAR file, not in a database dump attached "for context". A vulnerability report is read by more people than you think and lives in an advisory thread forever.

If a reproduction genuinely needs a credential:

- use a key you revoke in the provider's dashboard **before** sending the report, and say so;
- or use a syntactically valid fake with the same shape and length as the real one — the parsing bug you found does not care about the entropy;
- or describe the shape (`prefix`, length, header style) instead of pasting the value.

If you have already sent a live key, say so in the same thread immediately and revoke it at the provider. Deleting the message is not enough.

If GitHub private reporting is unavailable, contact the repository owner through a private channel listed on the [Navesz GitHub profile](https://github.com/Navesz). Never send a secret over a public channel.

## Response targets and coordinated disclosure

Prumo is maintained by one person. These are targets, not a service-level guarantee, and there is no bug bounty.

| Report class                                                                       | Acknowledgement | Initial assessment |
| ---------------------------------------------------------------------------------- | --------------- | ------------------ |
| Anything touching stored credentials, the KEK, sessions, or the outbound allowlist | 3 calendar days | 7 calendar days    |
| Everything else                                                                    | 7 calendar days | 14 calendar days   |

Validated reports are handled through a private GitHub advisory, a minimal fix, a regression test that fails without the fix, dependency and release review, and coordinated publication with the reporter. Credit is offered unless the reporter prefers anonymity.

Good-faith research is not pursued when it respects other people's data, avoids service disruption, and gives the project a reasonable window to fix the issue. Test against your own `docker compose up` instance. Do not test against an instance holding other people's provider keys — a successful test there is a real theft of a real credential that spends real money.

## Threat model

### What encryption at rest protects against

Credentials are stored with envelope encryption written against `node:crypto`, zero dependencies: AES-256-GCM, a 32-byte DEK per credential, the DEK wrapped by a 32-byte KEK. Each row carries its own nonces, the wrapped DEK, the ciphertext with the GCM tag, and `algoritmo` pinned by a one-item CHECK that never dispatches the decryptor.

That construction defends against the four things most likely to happen to a personal-scale project:

- a database dump handed to the wrong person;
- a leaked backup file;
- a restored read replica sitting on a host you forgot about;
- SQL injection that reads rows it should not — it gets ciphertext.

It also defends against a narrower and nastier case: an attacker with **write** access to the database moving a credential row from user A to user B's account. The additional authenticated data is `v1|id|usuario_id|provedor|tipo` and is **recalculated from the row, never stored**. Rewrite `usuario_id` and the GCM tag stops verifying. Had the AAD been a column, the attacker would move the row and the old AAD with it, and A's key would generate images billed to A inside B's account, silently.

### What it does not protect against

**A compromised host.** With remote code execution in the Prumo process, the attacker reads `process.env.PRUMO_KEK`, and every credential in the database decrypts. There is no partial mitigation to advertise here. The same is true of anyone who can run `docker inspect` on the container, read `/proc/<pid>/environ`, or open a crash dump.

It also does not protect against the operator, who has the KEK by definition. See the sentence at the top.

### Why the KEK is in an environment variable anyway

OWASP's [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) advises against holding secrets in environment variables, for exactly the reasons listed above: environment blocks are inherited by child processes, visible to container inspection, and captured by crash dumps and process listings. Prumo does it anyway, deliberately, and the trade is stated rather than hidden.

A managed KMS as the _only_ option kills `docker compose up`. Prumo's core promise is that a person can self-host in three commands and stop sending money to an intermediary; requiring an AWS or GCP account to boot converts that promise into a cloud signup funnel. Between "runs on a VPS in three commands, with a documented weakness against RCE" and "no weakness against RCE, and nobody self-hosts", the first was chosen.

The escape hatch is built into the schema, not promised for later: `credencial_provedor.kek_provedor` is an enum of `env`, `awskms`, `gcpkms`, and `kek_id` carries the key version (`env:v1`). The partial index on `(kek_id) WHERE status='ativa'` **is** the rewrap queue. Moving an instance from `env` to a KMS is a configuration line plus a rewrap pass, not a migration of a design. 🧪 The KMS plugs are specified and not yet written — see Known limitations.

### Losing the KEK is not recoverable

`PRUMO_KEK` is not a password that can be reset. Lose it and every stored credential is permanently undecryptable; every user re-pastes every key. Back it up offline, and see the next section for where not to put that backup.

## If you are the person pasting a key

**Create a key dedicated to Prumo.** Never paste the key you also use in a notebook, a CI job, or another product. A dedicated key can be revoked the moment something looks wrong, and revoking it breaks exactly one thing.

**Set a spend cap in the provider's own dashboard.** Prumo's budget ceiling (`orcamento`) governs what _Prumo_ spends with that key. It has no authority over what anyone else does with the same key once it leaves the database. The provider-side cap is the only limit that survives a leak.

🔴 **Not verified:** which of the thirteen mapped providers offer a per-key spend limit as of 2026-08. `docs/PROVEDORES.md` was compiled by reading official documentation, not by opening thirteen paid accounts and testing. Where a provider offers only an account-level cap, or none, the damage from a leaked key is bounded by your payment method, not by anything Prumo can do. Verifying this per provider is a documented open item, and until it is closed, treat every key you paste as unlimited.

Keep `verificada_em` in mind: Prumo validates a key with one cheap call to the provider when you save it. That call proves the key works, which also means the key was used. Providers that bill per request will show it.

## Operator checklist

For anyone self-hosting, including the official instance. Every item exists because skipping it silently removes a defense.

**1. Generate `PRUMO_KEK` with a CSPRNG.** 32 bytes, base64:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Not a passphrase, not a UUID, not the output of a password generator with a length limit you did not read.

**2. Store the KEK offline, in a different place from the database backup.** Encrypted backup stored next to the key that decrypts it is a plaintext backup with extra steps, and it is the single most likely way a Prumo instance leaks every key at once. Different medium, different provider, different physical location.

**3. `npm run backup` refuses to include `.env`.** The refusal is the point: a backup script that helpfully sweeps up the whole directory undoes item 2 automatically, on a schedule, forever. 🧪 Specified, not yet written — no product code exists yet.

**4. Rehearse the restore, and prove the keys decrypt afterwards.** A restore that brings the rows back but not the KEK version that wrapped them is a restore that produced a database of unreadable ciphertext. The rehearsal is a gate for M9 (public), not a suggestion: no external user before it passes.

**5. The Postgres role Prumo connects as must not be superuser and must not have `BYPASSRLS`.** Row-level security is the second door behind `usuario_id` in every repository query. A superuser role walks through both, and the isolation test still passes, because the test connects as the same role that ignores the policy — decorative RLS looks identical to working RLS from inside the application.

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Both flags must be `f`. Additionally, the role's `GRANT` on `lancamento` must exclude `UPDATE` and `DELETE`: the ledger is append-only, and that is enforced by privilege, not by application discipline.

**6. HTTPS only.** The session cookie is host-only and carries an opaque token; the database stores only its SHA-256. Serve over plaintext HTTP and the token is readable in transit, which is a full account takeover including the ability to dispatch generations that spend the victim's provider balance. Caddy is available as an optional compose profile; a reverse proxy you already trust is equally fine. There is no "local network is safe" exception here, because the thing behind the cookie is money.

**7. Do not expose the fingerprint pepper.** `credencial_provedor.impressao` is `HMAC-SHA256(pepper, plaintext key)`, used to stop the same key being registered twice. The pepper must live with the KEK, not in the database. Leaked alongside a dump, it lets an attacker _confirm_ a guessed key; it never reveals one.

**8. Workflows triggered by a fork receive no secrets.** This is a mandatory clause for the public repository. A pull request from a stranger with access to repository secrets is exfiltration in one commit.

## What is enforced by machine, not by promise

Listed so a reader does not have to trust a paragraph. Every item names the mechanism and its state. Nothing here is currently protecting product code, because product code does not exist yet — these land with the milestone that introduces the thing they guard.

| Rule                                                                    | Mechanism                                                                                                                                                                                                                                                     | State |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| No route returns a stored key, not even masked                          | `credencial_provedor` is write-only by design; the UI reads `ultimos4` and `verificada_em` only. A read route is what an authorization bug turns into a mass leak                                                                                             | 🧪 M2 |
| Provider key never reaches a log                                        | Mandatory redaction on the log serializer, plus provider error bodies sanitized before being written to `geracao.erro_detalhe` — several providers echo part of the received header back in the message                                                       | 🧪 M2 |
| The redaction actually works                                            | CI runs a full generation against a test key and greps the whole log for that key's prefix. A hit fails the build. This is the gate that makes the row above checkable instead of aspirational                                                                | 🧪 M2 |
| `axios` is banned repository-wide                                       | Boundary rule in `dependency-cruiser`. Its error object carries `config.headers`; one `console.error(err)` in a rare branch publishes a user's key. HTTP client is `fetch`/undici                                                                             | 🧪 M0 |
| Domain and application layers cannot import an HTTP client, S3, or `fs` | `dependency-cruiser`, denylist-with-named-exceptions, not allowlist-by-name. This is what mechanically enforces "no external I/O inside a transaction" — a retried transaction that re-calls a provider bills twice, and an external effect has no rollback   | 🧪 M0 |
| Every boundary rule is proven to fail                                   | Each rule ships with a planted violation that must be rejected. A rule that has never fired may be broken: the equivalent rule in a prior project reported "no dependency violations found" for months with React inside the domain layer                     | 🧪 M0 |
| AAD is recalculated, never stored                                       | Derived from the row as `v1                                                                                                                                                                                                                                   | id    | usuario_id | provedor | tipo` at encrypt and decrypt time | 🧪 M2 |
| Outbound request destinations are a closed list in code                 | There is no `base_url` column in the schema, deliberately. The server makes authenticated calls with the user's key, so any endpoint sourced from editable data is a credential-exfiltration route                                                            | 🧪 M1 |
| The spend ceiling cannot be raced                                       | Enforced by a conditional `UPDATE ... WHERE gasto + reservado + custo <= teto`; zero rows affected means the ceiling was hit. There is no check-then-act window for eight parallel dispatches to slip through                                                 | 🧪 M3 |
| No credential in the repository                                         | `ferramental/segredo/varrer-segredo.mjs` scans what Git tracks, wired into the pre-commit hook and the `verificar` gate; gitleaks in CI as the second pass                                                                                                    | 🧪 M0 |
| Retry is forbidden where it would double-bill                           | A read timeout against a model with `suporta_idempotencia=false` moves the generation to `duvida_de_cobranca` instead of retrying. WaveSpeed states in writing that a disconnected response can still correspond to a prediction that was accepted and billed | 🧪 M4 |

## What is not a vulnerability

These are documented design consequences. Reporting them is fine, and they will be closed with a link to this file rather than treated as findings:

- the operator of an instance can read stored keys;
- `PRUMO_KEK` in an environment variable, absent a new attack that reads it without code execution on the host;
- the last four digits of a key being visible in the UI;
- Prumo's budget ceiling not limiting what the provider bills through the same key outside Prumo;
- a ledger line marked `estimado` differing from the provider's invoice — Replicate exposes no billing API, so that line is an estimate permanently, and the estimate is labeled as one on screen.

An **unlabeled** estimate presented as a fact, on the other hand, is a bug worth reporting, because the whole product rests on the difference.

## Known limitations

Stated with the repository's marks, unretouched.

🔴 **Per-key spend caps are unverified across all thirteen providers** (as of 2026-08). Where a provider has none, a leaked key's blast radius is your payment method. This blocks the copy on the key-registration screen from making any promise about containment.

🔴 **Accounting for a generation that failed after the provider billed is undecided.** Until it is, no spend screen gets written — a spend screen built on an undecided rule is a screen that will lie.

🔴 **Image retention is undecided.** Generated bytes live in Prumo's storage with no expiry policy yet. Deciding retention after the first write turns it into a migration of large data, and it is also a privacy question: prompts and outputs can be personal.

🧪 **The entire architecture is decided, not measured.** The prior system this reasoning was inherited from has no backend at all. Every claim about behavior under concurrency, latency, or volume in this repository is a decision, not a measurement. Treating 🧪 as ✅ is the specific error the marks exist to prevent.

🧪 **The AWS KMS and GCP KMS plugs are specified, not written.** Today the only implemented KEK provider is `env` — and today nothing is implemented at all, which is the honest version of the same sentence.

🧪 **Webhook signature verification is designed and unwritten.** `provedor.assina_gancho` enumerates four schemes (`ed25519_jwks`, `hmac_standard`, `segredo_url`, `nenhuma`) precisely because the providers disagree. Until it exists and is tested, an unauthenticated webhook endpoint is an unauthenticated webhook endpoint.

🧪 **SSE through a real reverse proxy is unproven.** Any buffering proxy kills SSE silently. This is a reliability issue, not a security one, but a "generation finished" event that never arrives while the image URL expires — ten minutes at BFL — loses an image the user already paid for.

🧪 **Rate limiting lives in process memory.** Correct today because Prumo deploys as one process. It becomes wrong the day a second process is added, and it becomes wrong quietly.

🧪 **A single process is a single point of failure.** A deploy takes down HTTP, the worker, and SSE together. Drain mode (stop capturing, wait 30 s, exit) reduces the damage; the real fix is redundancy, which is the architecture this project deliberately declined.

---

Nothing in this document replaces human review. Any figure, provider behavior, or licensing claim in this repository produced with AI assistance must be verified by a person before it is displayed to a user as fact.
