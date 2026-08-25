# Support

Prumo is an early open-source project maintained on a best-effort basis. There is no guaranteed response time and no commercial support.

**Nothing generates an image yet.** M0 and M1 are under construction: there is no release, no running instance, and no product feature. Until that changes, the useful questions are about the design, the database schema, the provider survey, and how to contribute — not about how to fix a generation.

## Where to ask

- **[GitHub Discussions](https://github.com/Navesz/prumo/discussions)** — questions, ideas, "is this the right approach", self-hosting help, and anything you are not sure is a bug.
- **Issue templates** — a reproducible bug, a scoped feature, a **price correction** (`price_correction`), or a **new provider** (`new_provider`). A price that looks wrong is not a bug report; it is a `price_correction` issue, and it needs a source URL and a date.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — local development, the verification gate, and pull requests.
- **[SECURITY.md](SECURITY.md)** — anything exploitable, privately. Never in a public issue.

Before opening an issue, search existing issues and discussions and try the current `main`.

## What a bug report needs

Include:

- **Version or commit** of Prumo, and how you run it (`docker compose`, `PRUMO_PAPEL`, self-hosted or someone else's instance).
- **Provider slug and model id** as the catalog spells them: `fal:fal-ai/flux/schnell`, `runware:bfl:6@1`. A sub-endpoint is a different model.
- **The generation state** Prumo showed: `falhou`, `moderada`, `duvida_de_cobranca`, and so on — plus the generation and batch ids. The state name says more than a screenshot of the whole screen.
- **The provider's own request id** — fal's `x-fal-request-id`, a Replicate prediction id, a KIE `taskId`. It is the only handle their support can act on, and often the only way to tell one failed call from another.
- **The sanitized server log** for that request, with timestamps in UTC.
- **Whether money moved**: what Prumo's ledger says and what the provider's dashboard says. If the two disagree, say so explicitly — that disagreement is the bug.
- For a wrong cost: the request parameters that produced it (size, steps, number of images), because price is a formula, not a number per image.

**Never include:**

- your API key, or any part of it. A prefix is enough to identify an account and sometimes enough to use;
- your `.env`, `PRUMO_KEK`, or a database dump. The dump plus the KEK is every key of every user on that instance;
- an unredacted output URL — fal and Replicate CDN links can carry an access token in the query string;
- another user's email, prompts, or images.

If you already pasted a key somewhere public: rotate it at the provider first, then read the recovery steps in [CONTRIBUTING.md](CONTRIBUTING.md#never-paste-a-real-api-key). Deleting the comment does not undo it.

## Prumo is not your provider's support desk

Prumo has no account with fal, Replicate, KIE.ai, OpenAI, Google, BFL, Runware, WaveSpeed, Together, Novita, DeepInfra, or Segmind. **Your key is yours, the money is yours, and the contract is between you and them.** Prumo has no leverage there and cannot escalate on your behalf.

Take these to the provider, not here:

- **Billing and charges** — an invoice you dispute, a charge you did not expect, a refund.
- **Credits and payment** — buying credits, a declined card, a balance that did not appear.
- **Account verification** — OpenAI's organization verification with a document and facial recognition is theirs; Prumo cannot bypass, speed up, or appeal it.
- **Moderation** — a refused prompt, a blocked image, a suspended account. Moderation is terminal for Prumo: it is a final state, never retried, and never appealed by us.
- **Rate and concurrency limits** — a new fal account starts at 2 concurrent requests, WaveSpeed Bronze allows 2 concurrent and 5 per minute, and Replicate tightens to a few requests per minute when your balance is low. Raising those is a conversation with them.
- **Model availability** — a model deprecated, removed, or restricted to a region. A provider can deprecate image generation and leave the route answering, which is why Prumo tracks "route alive" separately from "model exists".
- **Watermarks and model terms** — every Google image carries SynthID, invisibly and non-removably. That is their product decision, and Prumo's job is to warn you before you spend, not to remove it.

**What Prumo can do:** show exactly what the provider answered, including the error class, the provider's message, and its request id; tell you what it believes you were charged and on what evidence (`exato`, `derivado`, or `estimado`); and say honestly when it does not know. `duvida_de_cobranca` means the call timed out and Prumo cannot tell whether the provider billed you — the provider's dashboard is the authority, not Prumo's ledger.

**What is a Prumo bug**, and belongs in an issue here:

- a cost shown on screen that does not match the provider's invoice;
- a spend ceiling that let a generation through;
- an image you paid for that Prumo failed to store before the provider's URL expired;
- a state shown as success when the generation failed, or as failure when it was billed;
- a wrong price in the catalog (open a `price_correction`);
- an adapter sending the wrong request shape or misreading a response.

## Self-hosted instances

If you are using an instance someone else runs, they are your first line of support — and they can read the keys you pasted there. That is how the vault works and it is stated on the credential screen, not buried here: the encryption protects a leaked backup or a stolen dump, not a compromised host or a curious operator. If you do not trust the operator, run your own instance or do not paste a key.

Create a key **dedicated to Prumo**, with a spending limit in the provider's own dashboard where the provider offers one. Prumo's ceiling is enforced by Prumo; the provider's ceiling is enforced by the provider, and only the second one survives a bug in the first. 🔴 Which of the thirteen providers offer a per-key spending limit has not been verified yet.
