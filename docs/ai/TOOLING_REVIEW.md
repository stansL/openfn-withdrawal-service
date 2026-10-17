# Contributor tooling change evidence

Scope: PR template, architecture navigation, focused prompts, phased planning guidance. No service runtime, API, schema or financial policy changes. Existing staged CI changes and unstaged Node upgrade files were preserved.

Review type: final-diff self-review, not independent review. This tooling change does not replace the protocol's independent review requirement for sensitive service changes. No hosted AI review is configured.

## Verification

- Node 24.22.0: `npm run verify` — typecheck, 48 tests passed with zero skips (including production adapter), production build passed. Initial sandbox run failed with `listen EPERM: operation not permitted 127.0.0.1`; rerun with local-server permission passed.
- Local Markdown links, provider-reference checks and `git diff --check` passed. No paid API or hosted workflow run performed.

## Invariant self-review

| AGENTS.md invariant | Result and evidence |
|---|---|
| Authorisation reserves without settling | PASS: runtime unchanged; reservation API/production-adapter tests pass |
| Active reservations never exceed posted balance | PASS: runtime unchanged; concurrent authorisation tests pass |
| Reservation and authorisation persistence atomic | PASS: runtime unchanged; rollback tests pass |
| Authoritative grant check at reservation | PASS: runtime unchanged; revocation-during-FX test passes |
| Same key/request creates no second reservation | PASS: runtime unchanged; concurrent replay tests pass |
| FX failure does not mutate account state | PASS: runtime unchanged; expired-hold zero-write test passes |
| No external calls inside transaction | PASS by inspection: runtime unchanged; quote awaited before synchronous commit; dedicated lifetime-test gap remains |
| Inaccessible/missing accounts share external 404 | PASS: runtime unchanged; anti-enumeration API test passes |
| Money avoids binary floating point | PASS: runtime unchanged; exact money and numeric-token tests pass |

## Tooling findings and limits

The paid external review integration was removed at the engineer's request before activation: workflow, provider runner, runner tests, provider instructions and setup documentation. The remaining PR template and contributor guidance are tool-neutral and require no API key. No new process sends repository content to an AI provider. Security concerns identified in the removed runner no longer apply to the retained changes.

Existing independent review, verification and human acceptance requirements remain authoritative. This change does not add secret scanning or establish hosted branch protections. Pre-existing CI and Node upgrade edits remain separate from this work.
