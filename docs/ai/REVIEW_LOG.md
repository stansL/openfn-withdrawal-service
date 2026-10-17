# Adversarial review log

This is a compact record of material review findings, not a transcript of every AI interaction.

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
- Mapping tests exposed a pre-existing FX distinction: expired holds may be released before an FX failure, while the existing test checks no new reservation on a fresh account. Recorded this limitation in INVARIANT_TEST_MAP.md; no runtime change or invariant relaxation was made. The engineer must resolve the distinction before changes to that path.

## API hardening — 2026-10-17

- Exposed persisted expiry with sequential/concurrent replay evidence; corrected the stale authorisation-code contract example.
- Replaced generic 400/404 protocol responses with 405/Allow, 415 and streaming 413; retained authentication precedence, request IDs and error envelopes.
- Used a non-destroying request iterator so early size-limit rejection can finish a structured response, then close the connection. A chunked upload test intentionally leaves the body unfinished to verify early rejection.
- Extended the production SQLite adapter test with deterministic duplicate-code rollback; retained cryptographic generation without adding a generator injection seam.
- Preserved original TTL timing and expired-hold cleanup. Recommended a separate read-only precheck / transaction-bound cleanup change to satisfy strict no writes on FX failure; engineer decision remains pending.

- Independent review (`hardening_review`) inspected the saved-original diff and final source/tests: no new correctness/security blockers. Eight invariants pass; strict FX no-mutation fails due to the pre-existing cleanup behavior above. The reviewer inspected the supplied 37-test verification evidence rather than independently rerunning the suite. No staging while this material finding remains unresolved; Git metadata is also absent.

## FX no-mutation correction — 2026-10-17

- Engineer authorized the recommended read-only precheck and transaction-bound cleanup, resolving the previously recorded policy conflict without weakening AGENTS.md.
- Removed precheck cleanup and its write transaction. Availability projects the effect of expired, unreleased holds with a single SELECT; existing authoritative commit still cleans up, checks grants/funds, reserves and persists atomically.
- Added zero-write FX failure coverage with expired holds on two accounts, expired replay without writes, mixed active/expired projection, cleanup rollback on persistence failure on both SQLite adapters, and concurrent reuse of expired funds.
- Preserved schema, response contracts, global cleanup scope and pre-FX TTL clock sampling. Stored reservation counters may include expired holds until a successful new authorisation; the precheck discounts those holds without changing them.
- Independent review (`expiry_review`) inspected the final diff and implementation/tests: no correctness/security blockers; all nine invariants pass, including FX no-mutation. Reviewer used supplied verification evidence rather than rerunning tests. `npm run verify` passed all 40 tests with zero skips, typecheck and build. Git metadata remains absent, so staging is unavailable.

## Assessment quality follow-up — 2026-10-17

- Started authorisation creation/expiry after FX and conversion, preserving original timestamps on replay; cleanup now uses that fresh timestamp. Added a slow-FX regression with latency longer than TTL.
- Added local Frankfurter HTTP/timeout/abort and successful circuit recovery coverage, plus exact money boundary and rounding tests.
- Shortened README while preserving Architecture before Workflow and both diagrams; moved detailed explanations and the AI process diagram into docs/SERVICE_GUIDE.md.
- Git setup, packaging and commits remain deferred. The private commit plan stays outside the repository; no artificial timing or history changes are made.
- Independent review (`quality_review`) found no correctness/security blockers and all nine invariants pass. Applied its test-robustness suggestion: 500 ms local HTTP timeout plus a fixture deadline/cleanup guard. Reviewer inspected source/tests/docs; verification was run by the implementing agent.

## Node 24 migration — 2026-10-17

- Expanded the action-runtime warning fix into an engineer-authorized application migration: Node 24.22.0 pin, Node 24 engine constraint and type definitions, public-registry lockfile metadata, README and v7 CI actions.
- No application logic, schemas, money policy or dependencies used in production changed. Verification covers both SQLite drivers, JSON source-token parsing, HTTP cancellation and fresh startup; all nine domain invariants must remain intact.
- Fresh public-registry `npm ci` on Node 24.22.0 reported zero vulnerabilities; all 48 tests ran with zero skips, typecheck and build passed, including the native SQLite adapter. Startup/explicit seed, readiness/docs, idempotent replay, access rejection, live Frankfurter conversion, persisted reservation checks and graceful shutdown passed with an isolated database.
- Independent review (`node24_review`) found no correctness/security blockers and all nine invariants pass. Hosted Ubuntu CI confirmation remains pending commit/push approval. npm emitted an install-script approval notice for better-sqlite3; installation and native execution succeeded.

## Maintainability boundaries — 2026-10-17

- Moved public response mapping into HTTP, removed status/retry-header semantics from domain failures and centralized HTTP translation. Added public-boundary coverage for FX error translation and unexpected objects spoofing known codes.
- Moved the FX provider port into application ports; implementations and test doubles now depend on that contract.
- Extracted schema/compatibility initialization, explicit demo fixtures, shared token hashing and driver contracts. Updated seed entry point and test callers; normal startup has no dependency on demo fixtures. Persistence operations from authentication lookup through reservation/rollback remain byte-for-byte unchanged; extracted schema/seed bodies preserve their operations.
- Updated README, service guide, contributor architecture map, focused prompts and invariant evidence. Historical implementation plan remains unchanged. Added reseeding and incompatible-schema regressions.
- `npm run verify` passed all 52 tests with zero skips, typecheck and build. Startup with a temporary database, explicit seed, health/readiness/docs, idempotent withdrawal, grant rejection, live Frankfurter conversion, persisted reservation checks and graceful shutdown all passed.
- Independent review (`boundary_review`) found no correctness/security blockers and all nine invariants pass. It independently confirmed unchanged schema/seed operations, persistence SQL, response serialization and HTTP semantics; it inspected supplied verification results rather than rerunning the full suite. No new dependencies or schema migrations were introduced.
