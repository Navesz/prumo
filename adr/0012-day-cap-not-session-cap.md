# 0012 — A day cap, not a session cap

**Status:** Accepted, 2026-08-24.

## Context

The `/generate` skill this project grew out of enforces two spending ceilings:
`SESSION_CAP` (US$ 10 per run of work) and `MONTHLY_CAP` (US$ 50 per calendar month).
The plan carried both names over, and the schema was drafted with
`window IN ('month', 'session')`.

Writing the window arithmetic made the problem obvious. "Session" has no definition
that survives this architecture:

- It is not the browser session. Generation is a background job; the worker keeps
  spending after the tab is closed, which is the whole reason the key vault had to move
  to the server (ADR 0004).
- It is not the login session either. A login lasts thirty days here, so a "session
  cap" would be a thirty-day cap wearing a misleading name.
- "Per run of work" is a real idea, but it belongs to a _batch_ — the fan-out of one
  prompt across N models — and a batch already has an explicit cost quote and an
  approval click. That is a different mechanism at a different layer.

A name whose meaning nobody can point at is a name that will be implemented three
different ways.

## Decision

The two windows are `month` and **`day`**. A day is "since midnight where you live",
computed in the user's IANA timezone.

The per-batch ceiling stays a batch concern and arrives with M4, together with
`politica_teto` (`tudo_ou_nada` × `ate_onde_couber`).

## Consequences

Both windows are now defined by the same function and testable the same way. The window
boundary is computed from `users.timezone`, never from UTC — Herz carries a recorded bug
(finding A2) of comparing a local day against UTC midnight, and here that mistake
releases money that should not have been available at the turn of the month.

`domain/windows.ts` computes a day as "the next calendar day", not "start + 24 h",
because a day is 23 or 25 hours long across a daylight-saving change. There is a test
for 8 March 2026 in `America/New_York` that fails if anybody replaces it with arithmetic.

### What we give up

The skill's per-run ceiling, which was genuinely useful for stopping a runaway loop
inside a single sitting. A daily cap is a coarser instrument: a loop can still burn a
whole day's budget in a minute. M4 has to bring back the per-batch quote-and-approve
step, and until it does, the day cap is the only ceiling below the month.

## Reconsider if

Someone reports burning a day's cap in a single unattended run before M4 ships. The fix
is the batch quote, not a redefinition of "session".
