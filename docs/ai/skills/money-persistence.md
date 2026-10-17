# Money and persistence guidance

Follow [the protocol](../CHANGE_PROTOCOL.md) and [invariants](../../../AGENTS.md). Inspect `src/domain/money.ts`, application ports/service and `src/db/database.ts`, then trace callers.

Review integer bounds, exact decimal parsing, rounding, conditional reservation, grant revalidation, idempotency uniqueness and full rollback. Keep cleanup and persistence atomic. Never infer permission or funds correctness from the pre-FX read alone. A driver replacement must preserve these semantics, not just the TypeScript interface.

Choose evidence from [the invariant map](../INVARIANT_TEST_MAP.md): money examples, concurrent requests, revoked grants during FX, expired holds, conflicting keys, insert failures and the production adapter. Report skipped native-driver tests. Sensitive changes require independent review under the protocol.
