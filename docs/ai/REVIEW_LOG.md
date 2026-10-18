# Adversarial review log

This is a compact record of material review findings, not a transcript of every AI interaction.
Entries describe findings, changes, evidence and outstanding limitations. Avoid narration about who requested or performed a change; retain accountability metadata where required for review or exception management.

| Finding | Decision |
|---|---|
| Initial implementation debited immediately although brief only says “authorise” | Changed to time-bound reservation; posted balance remains unchanged |
| Permission could change while FX call is in flight | Revalidate grant inside authoritative reservation transaction |
| Known demo tokens were created on every normal startup | Removed automatic seed; explicit `npm run seed` |
| Inaccessible vs nonexistent account responses could leak account existence | Collapse both to external 404 semantics |
| Fast tests used a different SQLite adapter from production | Add integration test against `better-sqlite3` temporary DB |
| Sequential idempotency alone did not prove race behavior | Add concurrent same-key test |
| Rollback behavior needed evidence after state mutation began | Add forced insert-failure rollback test |
| Retry backoff could synchronize a horizontally scaled fleet | Use full jitter |
| FX caching/fallback were tempting generic “resilience” additions | Deliberately defer pending staleness/provider-precedence business policy |
| Rounding policy was implicit | Document half-up/ISO-minor-unit assumption and test it |

## Workflow consolidation — 2026-10-17

- Made CHANGE_PROTOCOL.md authoritative for procedure and retained AGENTS.md as the owner of unchanged domain invariants. Clarified narrow task authorization, independent review requirements and the final human gate.
- Confirmed existing CI verification; hosted branch protections remain unverified. Git metadata is absent in this working folder, so staging is unavailable and saved originals are used for review.
- Mapping tests exposed a pre-existing FX distinction: expired holds may be released before an FX failure, while the existing test checks no new reservation on a fresh account. Recorded this limitation in INVARIANT_TEST_MAP.md; no runtime change or invariant relaxation was made. Resolution is required before changes to that path.

## API hardening — 2026-10-17

- Exposed persisted expiry with sequential/concurrent replay evidence; corrected the stale authorisation-code contract example.
- Replaced generic 400/404 protocol responses with 405/Allow, 415 and streaming 413; retained authentication precedence, request IDs and error envelopes.
- Used a non-destroying request iterator so early size-limit rejection can finish a structured response, then close the connection. A chunked upload test intentionally leaves the body unfinished to verify early rejection.
- Extended the production SQLite adapter test with deterministic duplicate-code rollback; retained cryptographic generation without adding a generator injection seam.
- Preserved original TTL timing and expired-hold cleanup. A separate read-only precheck / transaction-bound cleanup change was proposed to satisfy strict no writes on FX failure; the policy decision remained pending at this stage.

- Independent review of the saved-original diff and final source/tests found no new correctness/security blockers. Eight invariants pass; strict FX no-mutation fails due to the pre-existing cleanup behavior above. Verification evidence covered 37 tests; the suite was not independently rerun. No staging while this material finding remains unresolved; Git metadata is also absent.

## FX no-mutation correction — 2026-10-17

- Replaced write-producing precheck cleanup with a read-only precheck and transaction-bound cleanup, resolving the previously recorded policy conflict without weakening AGENTS.md.
- Removed precheck cleanup and its write transaction. Availability projects the effect of expired, unreleased holds with a single SELECT; existing authoritative commit still cleans up, checks grants/funds, reserves and persists atomically.
- Added zero-write FX failure coverage with expired holds on two accounts, expired replay without writes, mixed active/expired projection, cleanup rollback on persistence failure on both SQLite adapters, and concurrent reuse of expired funds.
- Preserved schema, response contracts, global cleanup scope and pre-FX TTL clock sampling. Stored reservation counters may include expired holds until a successful new authorisation; the precheck discounts those holds without changing them.
- Independent review of the final diff and implementation/tests found no correctness/security blockers; all nine invariants pass, including FX no-mutation. Verification evidence was inspected; tests were not independently rerun. `npm run verify` passed all 40 tests with zero skips, typecheck and build. Git metadata remains absent, so staging is unavailable.

## Assessment quality follow-up — 2026-10-17

- Started authorisation creation/expiry after FX and conversion, preserving original timestamps on replay; cleanup now uses that fresh timestamp. Added a slow-FX regression with latency longer than TTL.
- Added local Frankfurter HTTP/timeout/abort and successful circuit recovery coverage, plus exact money boundary and rounding tests.
- Shortened README while preserving Architecture before Workflow and both diagrams; moved detailed explanations and the AI process diagram into docs/SERVICE_GUIDE.md.
- Git setup, packaging and commits remain deferred. The private commit plan stays outside the repository; no artificial timing or history changes are made.
- Independent review of source, tests and documentation found no correctness/security blockers; all nine invariants pass. Improved test robustness with a 500 ms local HTTP timeout and a fixture deadline/cleanup guard. Verification was not independently rerun.

## Node 24 migration — 2026-10-17

- Updated the application runtime alongside the action-runtime warning fix: Node 24.22.0 pin, Node 24 engine constraint and type definitions, public-registry lockfile metadata, README and v7 CI actions.
- No application logic, schemas, money policy or dependencies used in production changed. Verification covers both SQLite drivers, JSON source-token parsing, HTTP cancellation and fresh startup; all nine domain invariants must remain intact.
- Fresh public-registry `npm ci` on Node 24.22.0 reported zero vulnerabilities; all 48 tests ran with zero skips, typecheck and build passed, including the native SQLite adapter. Startup/explicit seed, readiness/docs, idempotent replay, access rejection, live Frankfurter conversion, persisted reservation checks and graceful shutdown passed with an isolated database.
- Independent review found no correctness/security blockers; all nine invariants pass. Hosted Ubuntu CI confirmation remains pending commit/push approval. npm emitted an install-script approval notice for better-sqlite3; installation and native execution succeeded.

## Maintainability boundaries — 2026-10-17

- Moved public response mapping into HTTP, removed status/retry-header semantics from domain failures and centralized HTTP translation. Added public-boundary coverage for FX error translation and unexpected objects spoofing known codes.
- Moved the FX provider port into application ports; implementations and test doubles now depend on that contract.
- Extracted schema/compatibility initialization, explicit demo fixtures, shared token hashing and driver contracts. Updated seed entry point and test callers; normal startup has no dependency on demo fixtures. Persistence operations from authentication lookup through reservation/rollback remain byte-for-byte unchanged; extracted schema/seed bodies preserve their operations.
- Updated README, service guide, contributor architecture map, focused prompts and invariant evidence. Historical implementation plan remains unchanged. Added reseeding and incompatible-schema regressions.
- `npm run verify` passed all 52 tests with zero skips, typecheck and build. Startup with a temporary database, explicit seed, health/readiness/docs, idempotent withdrawal, grant rejection, live Frankfurter conversion, persisted reservation checks and graceful shutdown all passed.
- Independent review found no correctness/security blockers; all nine invariants pass. Schema/seed operations, persistence SQL, response serialization and HTTP semantics were independently confirmed unchanged. Supplied verification results were inspected; the full suite was not independently rerun. No new dependencies or schema migrations were introduced.

## Security automation — 2026-10-17

- Initial branch-protection inspection returned HTTP 403: private-repository protection required GitHub Pro or public visibility. The repository was private at this stage; no hosted settings changed, and workflow failures could not enforce merge/direct-push restrictions. Native paid scanning products were not assumed available.
- Full-history Gitleaks initially reported three historical findings. Inspected them: the README's public demo token and two deterministic token/idempotency-key test fixtures. Accepted only exact commit/file/rule/line fingerprints, owned by @stansL and expiring 2027-01-18. A validator rejects expired, invalid and duplicate exceptions before CI can run the scanner. No general file exclusions or secret-pattern allowlists were added.
- Self-review covers read-only workflow permissions, immutable upstream action SHAs, no persisted checkout credentials, checksum-verified Gitleaks, vendored/licensed rule provenance, disabled inline suppressions, timeouts, scanner failure propagation and no source/finding uploads. Application, schema, financial policy and API code are unchanged; all nine domain invariants pass by unchanged implementation and regression tests. This is self-review, not independent review.
- Local evidence: dependency audit found zero vulnerabilities; Semgrep ran 22 rules on all 26 application/script targets with zero findings; history scan passed with only the three exact exceptions. An additional current-worktree scan reported only those same public fixtures, with no new secret findings. Actionlint and documentation-link checks passed.
- Deliberate isolated probes confirmed high-severity vulnerable development dependencies fail the exact lockfile-only audit command; unsafe eval, shell spawning and interpolated SQLite SQL block; safe bound SQL/shell-free spawning pass; invalid scanner config fails; a synthetic token blocks despite inline suppression and remains redacted. `npm run verify` passed 54 tests with zero skips, typecheck and build. Hosted security execution/Dependabot activation remain pending human approval to publish; no hosted success is claimed.
- Public visibility was confirmed through the API. Branch-protection inspection then returned HTTP 404 (`main` unprotected): the plan restriction was resolved, but protection was not yet configured. Native secret scanning, push protection and Dependabot security updates were disabled at this stage. Uncommitted security changes were moved to `security/ci-hardening`; current policy/decision text was updated while retaining the earlier inspection as historical evidence. No hosted settings changed during this step.
- Enabled native secret scanning and push protection. Protected `main` with PRs, strict/up-to-date `verify` bound to GitHub Actions app 15368, admin enforcement, resolved conversations, no force pushes and no deletion. Required independent approvals remain zero because the repository has one collaborator and self-approval is unavailable; this review gap remains explicit. The three security checks still need to become required after their first hosted runs. Settings readback is configuration evidence, not a deliberate failing-PR enforcement test; no commits/pushes were made.
