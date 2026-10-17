# Repository instructions for AI coding agents

AI assistance is welcome in this assessment, but changes must remain **engineer-controlled**.

Read and follow [the change protocol](docs/ai/CHANGE_PROTOCOL.md), the authoritative procedure for changes, verification, review and approval. This file owns the non-negotiable domain invariants below; supporting prompts must not weaken them.

Before editing, read `README.md`, `DECISIONS.md`, the historical `docs/ai/PLAN.md`, the relevant code/tests and `docs/ai/skills/impact-analysis.md`. Read-only commands to inspect files, search callers and inspect Git state are permitted. Give a short written impact analysis and task-specific plan before editing: intended files, state owner, affected invariants, callers/contracts and tests.

A clear engineer request authorizes a narrow implementation within that scope; a separate plan approval is not required. Stop before editing if the plan conflicts with an invariant or cannot be implemented narrowly. Explain the conflict and alternatives. Seek approval for material scope expansion or changes to the non-negotiable invariants.

## Non-negotiable invariants
- Withdrawal authorisation **reserves** funds; it does not settle the posted balance.
- Active reservations must never exceed posted balance.
- Reservation + authorisation persistence are atomic.
- The authoritative account grant check happens at the reservation boundary.
- A retry with the same idempotency key/request must not create a second reservation.
- FX failure must not mutate account state.
- External network calls must not run inside the DB transaction.
- Inaccessible and nonexistent accounts have the same external 404 semantics.
- Money calculations must not use binary floating point.

## Workflow references

- [Change protocol](docs/ai/CHANGE_PROTOCOL.md): required steps and human gate.
- [Change and review template](docs/ai/CHANGE_TEMPLATE.md): task-specific plan and evidence.
- [Invariant-to-test map](docs/ai/INVARIANT_TEST_MAP.md): existing coverage and limitations.
- [Reusable prompts](docs/ai/skills/): focused aids governed by the protocol.

Do not commit, push, merge or deploy automatically. Stage only reviewed files after successful verification, then stop for explicit engineer approval.

## Architecture and focused guidance

Start with the [architecture map](docs/ai/ARCHITECTURE.md) for execution flow, state ownership and test boundaries. Load only the guidance relevant to the change:

- [Money and persistence](docs/ai/skills/money-persistence.md)
- [FX dependency](docs/ai/skills/fx-boundary.md)
- [HTTP contracts](docs/ai/skills/http-contracts.md)
- [Larger changes](docs/ai/skills/phased-planning.md)

Use the [PR template](.github/pull_request_template.md) to hand over evidence. The existing verification, required review and human acceptance remain authoritative.
