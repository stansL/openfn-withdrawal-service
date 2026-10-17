# HTTP contract guidance

Follow [the protocol](../CHANGE_PROTOCOL.md). Inspect `src/http/app.ts`, `routes.ts`, `contracts.ts`, `errors.ts`, `withdrawal-response.ts`, domain errors and application callers. Preserve the domain-to-HTTP status/header translation.

Keep route contracts and generated OpenAPI aligned. Check authentication precedence, missing/inaccessible account equivalence, account-independent method discovery, JSON media types, streaming byte limits, sanitized errors and request IDs. Do not leak credentials or authorisation details in logs.

Prove behaviour through HTTP in `test/operations-and-contract.test.ts` and `test/withdrawal-api.test.ts`. Test denied as well as permitted requests. Runtime/OpenAPI agreement alone does not prove either matches the intended API contract.
