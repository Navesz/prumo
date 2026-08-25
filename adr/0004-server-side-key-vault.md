# ADR 0004: The key vault lives on the server

- Status: Accepted
- Date: 2026-08-24

## Context

The v1 plan kept each user's provider key encrypted on their own device, unlocked by a passphrase, never readable by the server. That is the design a user deserves when the thing being stored is a credential that spends their money. It was discarded on technical grounds, not preference, and the grounds are four.

**1 · The browser cannot call the provider APIs.** CORS blocks the direct path at four of the providers that matter.

- BFL, measured directly on 2026-08-24: `curl -X OPTIONS https://api.bfl.ai/v1/flux-2-pro -H 'Origin: https://prumo.app'` returns HTTP 400 with the body `Disallowed CORS origin`. There is CORS machinery, but only for origins on BFL's own allowlist. Their documentation also states that CORS is not enabled on delivery URLs — so a browser could not even download the finished image.
- Replicate: the documented community failure is "No 'Access-Control-Allow-Origin' header is present" (replicate/replicate-javascript#164, 2023-11-29). That is issue evidence, not a preflight we ran; the official docs simply do not discuss CORS.
- OpenAI and Google are recorded as blocked in `docs/PROVEDORES.md`, with the same caveat attached in the source: neither was verified by preflight from the research machine (the Google host was unreachable, `curl` exit 35).

**2 · fal, the one provider whose client library advertises browser use, tells you to proxy.** Its documentation states that most production applications require a server-side proxy, and it ships proxy handlers built around the `x-fal-target-url` header for exactly that purpose. For Prumo the proxy is mandatory regardless of what fal's CORS headers say, because the key belongs to the _user_: a key in the browser is a key in the DOM, in the devtools network tab, and in any extension the user has installed.

**3 · No provider issues an ephemeral, scoped token for a browser.** All thirteen authenticate with the long-lived account key — `Authorization: Key`, `Bearer`, `x-key`, `x-goog-api-key`, `x-api-key`. There is nothing to hand a browser that is not the entire credential. WaveSpeed's `Access-Control-Allow-Origin: *` (measured 2026-08-24) is not a feature for this design; it is an invitation to paste the key into the client, which is worse than the problem it solves.

**4 · The decisive one: the work continues after the tab closes.** Fan-out means a queue, leases, polling with backoff, webhook ingestion, and ledger settlement. BFL's output URL lives 10 minutes. Replicate deletes the prediction record — input, output, logs — one hour after completion. A worker that must open the key at minute 7 to fetch an image cannot ask a closed tab for a passphrase. Zero-knowledge and background work do not coexist. Offering both would be theatre.

## Decision

Envelope encryption in the application, `node:crypto`, no dependency. AES-256-GCM, a 32-byte DEK per credential, a 32-byte KEK in `PRUMO_KEK`. `kek_provider` accepts `env` (default), `gcpkms`, `awskms`; switching is one configuration line plus a rewrap, and the rewrap path is written and tested at M2 — before anyone needs it, because the day you need a rewrap is the day you cannot afford to write one.

**The AAD is recomputed, never stored:** `v1|id|user_id|provider|type`. If it were a column, anyone with write access to the database could move user A's key row into user B's account carrying the old AAD, and the GCM tag would still verify. Recomputing it from the row's identity is what binds the ciphertext to its owner.

**No route reveals a key. Not even masked, not behind a "show" button.** The UI displays `last4` and `verified_at`. A read route is precisely the thing an authorization bug converts into a mass leak.

Rules this layer imposes on the rest of the project, all of them enforceable:

- **`axios` is banned everywhere.** Its error object carries `config.headers`, so one `console.error(err)` in a rare branch publishes a user's paid key into the log. HTTP client is `fetch`/undici.
- Provider errors are sanitized before being written to `generation.error_detail` — several providers echo part of the received header back in the message.
- CI greps the log of a full end-to-end run for the test key's prefix and fails on a hit.
- `npm run backup` refuses to include `.env`. An encrypted database backup stored next to its KEK is not a backup of an encrypted database, and it is the most likely of all the bad scenarios.
- The restore drill proves the keys decrypt _after_ the restore, not that the file copied.
- There is no `base_url` column, anywhere, on purpose. Every outbound destination is a closed list in code, because the server makes authenticated requests with the user's key and any endpoint coming from editable data is a credential exfiltration route.
- The UI instructs the user to create a key **dedicated to Prumo** with a spend limit set in the provider's own console. Prumo's cap is not the provider's cap. 🔴 It has not been verified which of the thirteen offer a per-key limit.

## Consequences

**Whoever hosts Prumo can read every user's paid key — including the owner, on the official instance.** This is a vault of trust in the operator, not a vault of secrecy. That sentence goes on the key-entry screen, not only in the README, and it goes there in the same size as everything else on the screen.

What the encryption at rest actually protects against is what is actually likely in a personal project: a database dump, a leaked backup, a restored replica, SQL injection. It does not protect against a compromised host — with RCE, the attacker reads `process.env.PRUMO_KEK` and the envelope opens.

Losing `PRUMO_KEK` is irreversible loss of every stored credential. An offline copy is mandatory, kept somewhere **different** from the database backup.

### What we give up

- The strongest claim available — "we cannot read your keys" — and with it the class of user who will only paste a credential into something that provably cannot read it. That user is not wrong, and we have nothing to offer them but self-hosting.
- Self-hosting stops being a nice option and becomes the only honest answer to "can you read my key?".
- The threat model now includes us. A log line, a debug endpoint left on, a support call with a shared screen — each is a credential incident, not an embarrassment.
- Custodial responsibility for third-party paid credentials, with no legal review behind this repository and no insurance behind the operator.
- The `passphrase` mode is now a value in an enum with no implementation, which is a promise-shaped hole in the schema. It stays because ADR-level intent is cheaper to keep than to reconstruct, not because it is scheduled.

## Reconsider if

A "generate with the tab open" mode becomes buildable: a synchronous, single-provider path with no queue, no retry after the tab closes, no webhook, where the browser holds the key for the duration of one request. The concrete trigger is measurable and has two halves, both required:

1. **At least 3 providers** pass a recorded preflight test from Prumo's own origin (`OPTIONS` returning `Access-Control-Allow-Origin` matching the origin, with the auth header allowed), the results committed with dates the way `docs/PROVEDORES.md` already records the BFL and WaveSpeed measurements; **and**
2. those same providers document a **per-key spend cap**, so the browser-held key is bounded by the provider rather than by our promise.

Until both hold, the `passphrase` value in `kek_provider` stays an empty seat. Half of it — open CORS without a spend cap — is worse than the current design, not better.
