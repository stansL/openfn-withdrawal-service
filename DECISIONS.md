# Key engineering decisions

| Area | Decision | Why now | Production evolution |
|---|---|---|---|
| Domain semantics | Authorisation creates a time-bound **reservation**, not an immediate debit | The brief asks to authorise, not settle/capture | Add explicit capture, expiry/release, reversal and ledger semantics |
| Persistence | SQLite via `better-sqlite3` behind application ports | Real transaction/constraint semantics with minimal reviewer setup | PostgreSQL, versioned migrations, HA/backups |
| Concurrency | Atomic conditional reservation at the state-owning boundary | Prevent concurrent over-authorisation | Keep invariant in DB; revisit locking/isolation only for more complex multi-row rules |
| Idempotency | Durable key + request hash + unique DB constraint | Lost responses/retries must not reserve twice | Retention/expiry policy and potentially shared/distributed operation registry |
| AuthN/AuthZ | Identity and account grants are separate | A valid token is not authority over every account | OIDC/OAuth, signed token claims/scopes, central policy as requirements grow |
| Anti-enumeration | Missing and inaccessible accounts both return 404 | Prevent account-ID discovery | Revisit only if product intentionally exposes account existence |
| TOCTOU | Access checked before FX and revalidated in reservation transaction | Permission can change while dependency call is in flight | Preserve authoritative mutation-boundary check |
| FX boundary | Timeout + bounded retry + full jitter + circuit breaker | Explicit assessment criterion; dependency is outside service reliability boundary | Shared egress controls/fallback policy if justified |
| FX caching/fallback | Architected for, deliberately not automatic | Staleness/provider disagreement changes financial semantics | Product-defined quote lifetime, provider precedence and acceptable variance |
| Money | USD cents + exact decimal FX arithmetic | Avoid binary floating-point financial errors | Domain money type/ledger conventions if scope expands |
| Rounding | Half-up to target ISO minor units for exercise | Deterministic policy required | Product/settlement policy decides authoritative rounding |
| API docs | Registered route contracts generate OpenAPI | Reduce runtime/documentation drift | Contract compatibility/deprecation governance |
| Demo data | Explicit `npm run seed`; no implicit startup seeding | Known credentials should not silently appear in normal runtime | External identity/account provisioning |
| AI | Evidence-based guarded workflow with plan/review artifacts | Exercise explicitly asks how AI was used | Team-owned agent/skill policies integrated into CI/tooling |
| Expiry response | Return persisted `expires_at`, unchanged on replay | Clients can observe the original validity window | TTL starts after FX and conversion, before the synchronous reservation transaction |
| HTTP protocol errors | Known path/wrong method: 405 + Allow; unsupported JSON media type: 415; body over 64 KiB: 413 | Distinguish protocol failures while retaining structured errors and request IDs | Revisit size/encoding policies only for concrete requirements |
| Authorisation codes | Cryptographically random 80-bit grouped identifier with DB uniqueness; collision rolls back and returns sanitized 500 | Opaque server-side reference, not standalone identity/account authority | Redeemable bearer use would require secret storage and single-use/replay policy |
| Account/token provisioning boundary | Explicit deterministic seed; no public creation/issuance APIs | Withdrawal authorisation consumes trusted identity, grants and accounts; onboarding and identity issuance have separate policy owners | OIDC/OAuth identity provider and upstream account/customer lifecycle |
| Expiry cleanup boundary | Read-only precheck discounts expired, unreleased holds; existing transaction commits cleanup with a new reservation and authorisation | FX failure must cause zero account-state writes; failed persistence rolls cleanup back too | Cleanup uses the post-FX authorisation timestamp; any background expiry process would be an explicit separate lifecycle |
