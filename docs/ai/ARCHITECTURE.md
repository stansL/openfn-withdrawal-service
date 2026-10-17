# Architecture map for contributors

[README](../../README.md) describes the service; [AGENTS.md](../../AGENTS.md) owns invariants and [CHANGE_PROTOCOL.md](CHANGE_PROTOCOL.md) owns procedure. This map is navigation, not a second policy source.

## Execution and state ownership

| Boundary | Source | Responsibility |
|---|---|---|
| Composition and lifecycle | `src/server.ts` | Construct adapters, readiness and shutdown |
| HTTP | `src/http/app.ts`, `routes.ts`, `contracts.ts` | Authenticate, validate, dispatch, serialize errors and generate OpenAPI |
| Identity | `src/auth/auth-service.ts` | Resolve bearer token to principal through AuthenticationStore |
| Application | `src/application/withdrawal-service.ts`, `ports.ts` | Coordinate access projection, replay, FX, conversion and commit |
| Money | `src/domain/money.ts` | Integer cents, exact decimal conversion and rounding |
| Persistent state | `src/db/database.ts` | Own accounts, grants, holds, authorisations and durable idempotency |
| External dependency | `src/fx/exchange-rate.ts` | Quote provenance, HTTP, timeout, retry and circuit breaker |

Paths above are relative to the repository root. Trace direct callers before changing an interface.

The application reads access and availability, checks existing idempotency, then awaits FX. After conversion it samples creation/expiry time and invokes the synchronous persistence boundary. `commitAuthorisation` uses BEGIN IMMEDIATE: recheck idempotency, release expired holds, conditionally reserve with a grant check, persist, commit. Any failure rolls back. Reads discount expired holds without cleanup writes. Network calls stay outside the transaction. A reservation does not settle the balance.

## Test boundaries

Prefer the highest existing public boundary that proves the behaviour:

- HTTP: `test/withdrawal-api.test.ts`, `test/operations-and-contract.test.ts`.
- Persistence: `test/database-invariants.test.ts`, `test/production-adapter.test.ts`; include the real driver for SQL/transaction changes.
- FX: `test/fx-resilience.test.ts`, including local HTTP fixtures and injected timing.
- Money: `test/money.test.ts`, with independently calculated examples and boundary values.
- Operations: configuration, logging and seed tests under `test/`.

Use [the invariant map](INVARIANT_TEST_MAP.md) for exact evidence and limitations. Test observable outcomes rather than private helper calls. Group assertions about one operation; avoid recomputing expected values using the implementation. Multi-process contention remains a coverage gap.
