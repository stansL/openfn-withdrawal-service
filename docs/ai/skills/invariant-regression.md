# Prompt: Invariant regression

Follow [the change protocol](../CHANGE_PROTOCOL.md). Review the proposed diff against [AGENTS.md](../../../AGENTS.md) and [the invariant-to-test map](../INVARIANT_TEST_MAP.md). Identify affected invariants and meaningful adversarial tests for concurrency, retries, partial failure, authorization changes, dependency failure and contract compatibility.

Prefer executable evidence over prose reassurance. Distinguish existing tests, proposed tests, skipped tests and code inspection. Update the map when coverage changes. Do not add runtime tests for documentation-only changes or claim that a passing suite proves an untested property.
