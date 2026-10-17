# FX boundary guidance

Follow [the protocol](../CHANGE_PROTOCOL.md). Inspect `src/application/ports.ts` (the FX port), `src/fx/exchange-rate.ts` (implementations), its application caller and `test/fx-resilience.test.ts`.

Check cancellation through headers and body, bounded attempts, retryable versus unsupported errors, jitter, single half-open probe, recovery and exact rate-token/pair provenance. The breaker is process-local. FX failure must leave account state untouched, including expired holds. Use deterministic timing or local HTTP fixtures; do not depend on live provider availability.

Caching, stale quotes and provider fallback need explicit business policy; do not add them as incidental resilience fixes. Preserve the network/transaction boundary and use independent review when that boundary changes.
