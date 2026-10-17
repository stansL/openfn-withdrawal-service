# Historical AI-assisted implementation plan

This records the original assessment implementation. For new changes, follow [CHANGE_PROTOCOL.md](CHANGE_PROTOCOL.md) and write a task-specific plan using [CHANGE_TEMPLATE.md](CHANGE_TEMPLATE.md). The invariant list below records the original assumptions; [AGENTS.md](../../AGENTS.md) owns the current non-negotiable invariants.

## Objective
Implement the supplied withdrawal-authorisation endpoint with a small codebase and strong correctness/security/failure semantics.

## Explicit assumptions
- The endpoint **authorises** a withdrawal; it does not capture/settle it.
- A successful authorisation reserves USD funds for 5 minutes by default.
- Capture/reversal are separate future commands and intentionally out of scope.
- Frankfurter provides a reference rate for the exercise; production executable pricing may have different rules.
- Half-up target-currency rounding is an exercise policy.

## Invariants
- Authentication and account authorisation are distinct.
- An inaccessible account cannot be distinguished from a nonexistent account through this endpoint.
- Posted balance is unchanged by authorisation.
- Active reservations can never exceed posted balance.
- Concurrent requests cannot reserve the same available funds twice.
- One logical idempotent request produces one reservation.
- Reservation and persisted authorisation are atomic.
- FX failure never changes account state.
- External network calls never execute while the DB transaction is held.

## Implementation slices
1. HTTP contract + validation + stable errors.
2. Persistence schema, auth/token/grant model, explicit seed fixtures.
3. Authorisation/reservation + idempotency + concurrency semantics.
4. FX abstraction and bounded resilience policy.
5. Observability/lifecycle/OpenAPI hardening.
6. Risk-driven tests and production-adapter integration test.
7. Documentation, AI evidence and final adversarial review.

## Ongoing verification

The current verification and approval requirements live in [CHANGE_PROTOCOL.md](CHANGE_PROTOCOL.md).
