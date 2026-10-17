# Service design and operations

Supporting detail for the [README](../README.md).

## Core domain assumption: authorisation is not settlement

The brief asks the service to **authorise** a withdrawal, check that sufficient funds exist, and return an authorisation code. It does not ask this endpoint to settle or capture the withdrawal.

I therefore model a successful request as a **time-bound reservation of available USD funds**:

- the posted account balance is unchanged;
- the authorised USD amount is reserved so concurrent authorisations cannot promise the same funds twice;
- the exercise default authorisation lifetime is **5 minutes** (`AUTHORISATION_TTL_SECONDS`);
- prechecks discount expired holds without writing; expiry cleanup commits together with a successful new authorisation;
- a future capture/settlement endpoint would consume a valid authorisation and post the actual debit. That lifecycle is intentionally outside this exercise.

The response exposes the persisted `expires_at` in UTC; retries return the original expiry. The lifetime starts from the service clock sampled after FX and conversion, immediately before the reservation transaction; dependency latency does not consume the configured TTL.

The fixed five-minute lifetime is an explicit exercise assumption, not a claim about universal banking policy. In production, authorisation lifetime and FX quote validity would be product/financial-policy decisions.

## Persistence decision

SQLite via `better-sqlite3` gives the exercise real transactions, uniqueness constraints and concurrency semantics without requiring reviewers to provision a database server.

It is **not** my recommendation for a high-write production financial service. A production evolution would likely use PostgreSQL with versioned migrations, backup/restore, HA and operational tooling. The application flow should remain stable because persistence is behind `AuthenticationStore` / `WithdrawalStore` ports.

`src/db/schema.ts` owns schema initialization and compatibility checks. `src/db/demo-seed.ts` owns explicit fixtures, invoked by `src/seed.ts`; normal startup does not import demo provisioning. Driver contracts live in `src/db/sql-driver.ts`. `AppDatabase` retains authentication lookups and the complete reservation transaction.

Important invariants are enforced at the persistence boundary:

- posted balance remains unchanged during authorisation;
- `reserved_usd_cents <= balance_usd_cents`;
- reserve only when `balance - reserved >= requested amount`;
- account access is revalidated in the same transaction as the reservation;
- reservation + authorisation record commit together or both roll back;
- `(subject_id, idempotency_key)` is unique.

## Authentication and account authorisation

Bearer tokens are stored as SHA-256 hashes in the exercise database rather than plaintext.

Authentication establishes the principal. Account authorisation is a separate decision.

For an authenticated caller, **a nonexistent account and an inaccessible account both return `404 account_not_found`**. Internally they remain distinct conditions, but exposing different API results would allow account-ID enumeration.

Production identity would normally be delegated to OIDC/OAuth infrastructure with issuer/audience/expiry/signature/scopes or claims validation. That is deliberately not recreated inside a two-hour coding exercise.

### Why there are no account-creation or token-issuance endpoints

This service owns withdrawal authorisation. For the assessment, account/principal/token provisioning is deliberately handled by explicit, deterministic `npm run seed` fixtures, making grants and credential validation repeatable without startup silently creating trust.

Account onboarding introduces ownership, funding and lifecycle policies; token issuance introduces credential enrollment, rotation, recovery and key management. Those belong to their owning domains. In production, identity issuance and token expiry would normally be delegated to an OIDC/OAuth provider, with account state supplied by the account/customer system through the existing narrow boundaries.

## Idempotency

`Idempotency-Key` is optional because it is not required by the supplied API contract, but it is supported because network retries around a financial operation are normal.

- same principal + same key + same request -> original success is replayed;
- same key + different request -> `409 idempotency_conflict`;
- concurrent requests using the same key converge on one reservation;
- correctness is backed by a database uniqueness constraint, not only an in-memory check.

This is not just HTTP duplicate suppression: it gives one logical financial operation a stable identity across retries.

## Authorisation codes

Codes are opaque identifiers for persisted authorisations, formatted as four groups of four characters. Generation uses Node's cryptographic `randomInt` over a 32-character alphabet excluding `I`, `O`, `0` and `1`, giving 80 bits of randomness. A database uniqueness constraint rejects collisions; reservation and authorisation roll back together. Collision rejection produces a sanitized internal error; generation is not automatically retried.

The code does not independently establish identity or account authority. If future capture makes it a redeemable bearer secret, its storage and redemption policy must address hashing, single use and replay protection.

## FX dependency and failure containment

Frankfurter is isolated behind `ExchangeRateProvider`.

The resilient boundary applies:

- outbound timeout;
- bounded exponential retry;
- full jitter to avoid synchronized retry waves across a fleet;
- process-local circuit breaking;
- explicit unsupported-pair handling;
- response validation and rate provenance (`provider`, effective date, pair/rate validation).

The FX call occurs **outside the database transaction**, so external latency/retries do not hold database transactional resources.

I deliberately did not add automatic fallback providers or stale-rate caching. Those change financial semantics: different providers may disagree, and caching introduces a policy for acceptable quote staleness. The architecture makes those additions localized once product defines the policy.

## Money and rounding

USD account state uses integer cents. FX conversion uses exact decimal-string arithmetic rather than binary floating point.

For this exercise, converted amounts use **half-up rounding to the target currency's ISO minor-unit precision**. That is a documented exercise policy, not an assertion that every production settlement domain should use half-up rounding. A real product's pricing/settlement policy would own this rule.

## API contract and documentation

`src/http/withdrawal-response.ts` serializes domain records into the public response. Domain failures carry stable codes/messages; `src/http/errors.ts` owns their HTTP status/header translation and protocol-only errors. Unexpected failures retain sanitized 500 responses. Application-owned ports in `src/application/ports.ts` describe identity, withdrawal persistence and FX dependencies without importing concrete adapters.

The HTTP route contracts are the source for both routing/validation metadata and OpenAPI generation. This avoids keeping a separate handwritten API document that can silently drift from runtime behavior.

- `/` - static service landing page with links to documentation and operational checks; loading it does not probe dependencies
- `/docs` - Swagger UI
- `/openapi.json` - OpenAPI 3.0 document
- `/healthz` - process liveness
- `/readyz` - lifecycle/database readiness

Readiness deliberately does **not** call the FX provider. Restarting healthy application instances does not repair an unavailable upstream service and can amplify an incident.

The JSON endpoint accepts `application/json`, optionally with `charset=utf-8` (case-insensitive). Other well-formed media-type parameters do not change its UTF-8 decoding. Authentication precedes body validation for supported withdrawal requests.

| HTTP status | Protocol behavior |
|---|---|
| `400` | Malformed JSON or invalid request fields |
| `404` | Unknown route, or an account missing/inaccessible to the authenticated caller |
| `405` | Known route with an unsupported method; `Allow` lists supported methods without querying account state |
| `413` | Request body exceeds 64 KiB, checked in bytes while streaming |
| `415` | Missing/unsupported JSON media type or unsupported character encoding |

Protocol errors retain the structured error envelope and request ID. Oversized uploads receive the error response with the connection closed. Unexpected failures return a sanitized `500` response.

## Observability and lifecycle

The service includes:

- structured JSON request logging;
- redaction of credential-like fields;
- validated/safe caller correlation IDs;
- consistent error envelopes with `request_id`;
- fail-fast configuration validation;
- bounded graceful shutdown;
- request-size limits and security headers;
- separate liveness/readiness semantics.

## Test strategy

Tests target business and failure risks rather than a coverage percentage.

They cover, among other cases:

- valid authorisation reserves funds without changing posted balance;
- missing/invalid/revoked authentication;
- multiple-account, single-account, zero-access and shared-account fixture combinations;
- inaccessible and nonexistent accounts have identical anti-enumeration semantics;
- account authorisation revoked while an FX call is in flight;
- insufficient **available** funds;
- concurrent authorisations cannot over-reserve the account;
- sequential and concurrent idempotent retries;
- rollback when authorisation persistence fails after reservation logic begins;
- expired reservation release;
- external FX timeout/retry/circuit behavior and unsupported pairs;
- no reservation when FX is unavailable;
- target-currency minor-unit rounding;
- runtime/OpenAPI contract consistency;
- configuration, request IDs, logging and readiness;
- production `better-sqlite3` adapter integration against a temporary file database.

## AI-assisted engineering

I have intentionally documented my AI use as part of the engineering process. See [`AI_USAGE.md`](../AI_USAGE.md), [`AGENTS.md`](../AGENTS.md), and [`docs/ai/`](ai).

The ongoing workflow is defined in [the change protocol](ai/CHANGE_PROTOCOL.md). Use [the change template](ai/CHANGE_TEMPLATE.md) for task plans and review evidence, and [the invariant-to-test map](ai/INVARIANT_TEST_MAP.md) to select verification.

The workflow is:

```mermaid
flowchart LR
    explore[Explore] --> plan[Plan]
    plan --> implement[Implement narrowly]
    implement --> targeted[Test changed area and callers]
    targeted --> verify[Full verify]
    verify --> review[Adversarial review]
    review --> stage[Stage reviewed files]
    stage --> gate([Human approval gate])
```

AI was used to challenge assumptions, trace impacts, propose candidate implementation/test changes and run adversarial reviews. Engineering decisions remained human-controlled: proposed changes were checked against invariants, existing tests, callers/contracts and explicit trade-offs before acceptance.

## Conscious omissions / production evolution

These are not forgotten basics; their correct design depends on requirements absent from the brief:

- **account status, transaction/daily limits, fraud/risk, jurisdiction controls and a ledger** - require business policy; future checks can compose in the application workflow with authoritative state checks at persistence boundaries;
- **capture/settlement/reversal lifecycle** - authorisation and reservation are implemented; actual debit/capture is a separate command;
- **PostgreSQL + formal schema migrations/HA/backups** - production persistence concern;
- **OIDC/OAuth identity provider** - production identity boundary;
- **automatic FX-provider failover** - needs provider precedence/variance policy;
- **FX caching/stale-rate fallback** - needs quote-age policy;
- **distributed circuit-breaker state** - current breaker protects local capacity; fleet-wide policy belongs at an appropriate shared boundary if required;
- **gateway/global rate limiting** - a process-local limiter would be misleading under horizontal scale;
- **multi-region active-active financial writes** - requires an explicit consistency/write-ownership strategy;
- **Kafka/Redis/event sourcing/sharding/CDC** - no requirement currently justifies their operational cost.

See [`DECISIONS.md`](../DECISIONS.md) for the concise decision record.

## Configuration

See [`.env.example`](../.env.example). Important settings include:

- `DATABASE_PATH`
- `AUTHORISATION_TTL_SECONDS` (default 300)
- `FX_BASE_URL`
- `FX_TIMEOUT_MS`
- `FX_MAX_ATTEMPTS`
- `FX_CIRCUIT_FAILURE_THRESHOLD`
- `FX_CIRCUIT_COOLDOWN_MS`
- `SHUTDOWN_GRACE_MS`
